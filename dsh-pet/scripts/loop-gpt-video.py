import argparse
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


def premultiply(frame):
    result = frame.astype(np.float32) / 255
    result[:, :, :3] *= result[:, :, 3:4]
    return result


def warp_between(first, last, forward, backward, amount):
    if amount <= 0:
        return first.copy()
    if amount >= 1:
        return last.copy()
    height, width = first.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    first_warp = cv2.remap(premultiply(first), grid_x - amount * forward[:, :, 0], grid_y - amount * forward[:, :, 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    last_warp = cv2.remap(premultiply(last), grid_x - (1 - amount) * backward[:, :, 0], grid_y - (1 - amount) * backward[:, :, 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    result = first_warp * (1 - amount) + last_warp * amount
    result[:, :, :3] /= np.maximum(result[:, :, 3:4], 1e-6)
    result[result[:, :, 3] == 0] = 0
    return np.clip(result * 255, 0, 255).round().astype(np.uint8)


def choose_endpoints(frames, fps):
    small = np.stack([cv2.resize(premultiply(frame), (96, 96), interpolation=cv2.INTER_AREA) for frame in frames])
    return choose_small_endpoints(small, fps)


def choose_small_endpoints(small, fps):
    weights = np.ones((96, 96, 4), dtype=np.float32)
    weights[:58] = 1.5
    best = None
    for start in range(min(fps, len(small) - 1)):
        for end in range(max(start + 7 * fps, len(small) - 3 * fps), len(small)):
            distance = np.mean(np.abs(small[start] - small[end]) * weights)
            velocity = np.mean(np.abs((small[start + 1] - small[start]) - (small[end] - small[end - 1])) * weights)
            score = float(distance + velocity * 0.2)
            if best is None or score < best[0]:
                best = (score, start, end)
    if best is None:
        raise ValueError('Loop endpoint search requires at least seven seconds')
    return best[1], best[2], best[0]


def loop_video(source, output, bridge_frames=12):
    details = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', str(source)]))['streams'][0]
    width, height = details['width'], details['height']
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 4)
    start, end, score = choose_endpoints(frames, 24)
    first, last = frames[end], frames[start]

    def gray(frame):
        rgba = premultiply(frame)
        rgb = rgba[:, :, :3] + 0.5 * (1 - rgba[:, :, 3:4])
        return cv2.cvtColor(np.clip(rgb * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)

    estimator = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    forward = estimator.calc(gray(first), gray(last), None)
    backward = estimator.calc(gray(last), gray(first), None)
    bridge = [warp_between(first, last, forward, backward, index / (bridge_frames + 1)) for index in range(1, bridge_frames + 1)]
    result = np.concatenate((frames[start:end + 1], np.stack(bridge)))
    original = np.stack([premultiply(frame) for frame in frames])
    looped = np.stack([premultiply(frame) for frame in result])
    adjacent = np.abs(np.diff(looped, axis=0)).mean(axis=(1, 2, 3)) * 255
    old_seam = float(np.abs(original[0] - original[-1]).mean() * 255)
    new_seam = float(np.abs(looped[0] - looped[-1]).mean() * 255)
    output.mkdir(parents=True, exist_ok=True)
    master = output / 'idle-gemini-loop-v2.webm'
    preview = output / 'idle-gemini-loop-v2.webp'
    report = output / 'idle-gemini-loop-v2.json'
    if any(path.exists() for path in (master, preview, report)):
        raise FileExistsError('Loop outputs already exist; choose a new output directory')
    temporary_master = master.with_suffix('.partial.webm')
    temporary_preview = preview.with_suffix('.partial.webp')
    encoder = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}', '-r', '24', '-i', '-',
        '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '20', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', str(temporary_master),
        '-an', '-vf', 'scale=-2:220', '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary_preview),
    ], stdin=subprocess.PIPE)
    try:
        encoder.stdin.write(result.tobytes())
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError('Loop encode failed')
        temporary_master.rename(master)
        temporary_preview.rename(preview)
        report.write_text(json.dumps({
            'source': str(source.resolve()), 'retainedFrameRangeInclusive': [start, end],
            'bridgeFrames': bridge_frames, 'flow': 'OpenCV DIS medium, bidirectional, premultiplied RGBA warp then blend',
            'frames': len(result), 'fps': 24, 'durationSeconds': len(result) / 24,
            'endpointSearchScore': score, 'oldBoundaryMeanPremultipliedRGBA': old_seam,
            'newBoundaryMeanPremultipliedRGBA': new_seam,
            'medianAdjacentMeanPremultipliedRGBA': float(np.median(adjacent)),
            'maxAdjacentMeanPremultipliedRGBA': float(np.max(adjacent)),
            'visualAcceptance': 'Pending: flow can distort hair, wings and occlusions. Not a perfect-loop guarantee.',
        }, indent=2) + '\n')
        print(report.read_text())
    finally:
        if not encoder.stdin.closed:
            encoder.stdin.close()
        if encoder.poll() is None:
            encoder.terminate()
        encoder.wait()
        temporary_master.unlink(missing_ok=True)
        temporary_preview.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build a short optical-flow bridge for the GPT idle video.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    arguments = parser.parse_args()
    loop_video(arguments.source, arguments.output)
