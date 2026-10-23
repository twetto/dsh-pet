import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


def premultiply(frame):
    pixels = frame.astype(np.float32) / 255
    pixels[:, :, :3] *= pixels[:, :, 3:4]
    return pixels


def align_neighbor(neighbor, flow, reverse):
    height, width = flow.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    map_x, map_y = grid_x + flow[:, :, 0], grid_y + flow[:, :, 1]
    aligned = cv2.remap(premultiply(neighbor), map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    aligned[:, :, :3] /= np.maximum(aligned[:, :, 3:4], 1e-6)
    closure = flow + cv2.remap(reverse, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    confidence = np.exp(-np.sum(closure ** 2, axis=2) / 0.75 ** 2)
    confidence *= (map_x >= 0) & (map_x <= width - 1) & (map_y >= 0) & (map_y <= height - 1)
    return aligned, confidence


def edge_band(alpha):
    kernel = np.ones((3, 3), dtype=np.uint8)
    return cv2.dilate(alpha, kernel) - cv2.erode(alpha, kernel) > 0.02


def filter_matte(current, neighbors):
    pixels = current.astype(np.float32) / 255
    alpha = pixels[:, :, 3].copy()
    boundary = edge_band(alpha)
    alpha_sum = alpha.copy()
    weight_sum = np.ones_like(alpha)
    color_sum = pixels[:, :, :3] * alpha[:, :, None]
    color_weight = alpha.copy()
    for aligned, confidence in neighbors:
        neighbor_alpha = aligned[:, :, 3]
        color_error = np.sqrt(np.mean((pixels[:, :, :3] - aligned[:, :, :3]) ** 2, axis=2))
        comparable = (alpha > 0.1) & (neighbor_alpha > 0.1)
        compatible = ~comparable | (color_error < 0.18)
        coverage_agreement = np.clip(1 - np.abs(alpha - neighbor_alpha) / 0.35, 0, 1)
        weight = 0.5 * confidence * compatible * coverage_agreement * boundary
        alpha_sum += neighbor_alpha * weight
        weight_sum += weight
        color_sum += aligned[:, :, :3] * (neighbor_alpha * weight)[:, :, None]
        color_weight += neighbor_alpha * weight
    pixels[:, :, 3] = alpha_sum / weight_sum
    newly_visible = (alpha <= 0.01) & (pixels[:, :, 3] > 0)
    pixels[:, :, :3][newly_visible] = (color_sum / np.maximum(color_weight[:, :, None], 1e-6))[newly_visible]
    result = np.clip(pixels * 255, 0, 255).round().astype(np.uint8)
    result[result[:, :, 3] == 0] = 0
    return result


def downsample(frame, width, height):
    pixels = cv2.resize(premultiply(frame), (width, height), interpolation=cv2.INTER_AREA)
    pixels[:, :, :3] /= np.maximum(pixels[:, :, 3:4], 1e-6)
    pixels[pixels[:, :, 3] == 0] = 0
    return np.clip(pixels * 255, 0, 255).round().astype(np.uint8)


def measure(frames, forward, backward, bands):
    residuals, gradients = [], []
    for index, frame in enumerate(frames):
        alpha = frame[:, :, 3].astype(np.float32) / 255
        aligned, confidence = align_neighbor(frames[(index + 1) % len(frames)], forward[index], backward[index])
        weights = bands[index] * confidence
        residuals.append(float((np.abs(alpha - aligned[:, :, 3]) * weights).sum() / max(weights.sum(), 1)))
        gradient = np.hypot(cv2.Sobel(alpha, cv2.CV_32F, 1, 0), cv2.Sobel(alpha, cv2.CV_32F, 0, 1))
        gradients.append(float(gradient[bands[index]].mean()))
    return {'meanFlowAlignedEdgeAlphaDifference': float(np.mean(residuals)), 'meanEdgeGradient': float(np.mean(gradients)), 'wrapFlowAlignedEdgeAlphaDifference': residuals[-1]}


def encode(frames, destination, fps, master=False):
    first = frames[0]
    height, width = first.shape[:2]
    options = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '20', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4'] if master else ['-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0']
    process = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}', '-r', str(fps), '-i', '-', '-an', *options, str(destination)], stdin=subprocess.PIPE)
    try:
        for frame in frames:
            process.stdin.write(frame.tobytes())
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError('Temporal matte encode failed')
    finally:
        if not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            process.terminate()
        process.wait()


def prepare(source, output):
    details = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', str(source)]))['streams'][0]
    width, height = details['width'], details['height']
    fps = Fraction(details['r_frame_rate'])
    output.mkdir(parents=True, exist_ok=True)
    names = ['idle-temporal-v5.webm', 'idle-temporal-v5.webp', 'idle-control-v5.webp']
    destinations = [output / name for name in names]
    report = output / 'idle-temporal-v5.json'
    if any(path.exists() for path in [*destinations, report]):
        raise FileExistsError('Temporal outputs already exist; choose a fresh directory')
    temporary = [path.with_name(path.stem + '.partial' + path.suffix) for path in destinations]
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 4)
    if len(frames) < 3:
        raise ValueError('Temporal filtering requires at least three frames')
    gray = []
    for frame in frames:
        pixels = premultiply(frame)
        composite = pixels[:, :, :3] + 0.5 * (1 - pixels[:, :, 3:4])
        gray.append(cv2.cvtColor(np.clip(composite * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY))
    estimator = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    forward, backward = [], []
    print('Estimating circular neighbor flow...', flush=True)
    for index in range(len(frames)):
        next_index = (index + 1) % len(frames)
        forward.append(estimator.calc(gray[index], gray[next_index], None))
        backward.append(estimator.calc(gray[next_index], gray[index], None))
    result = []
    bands = [edge_band(frame[:, :, 3].astype(np.float32) / 255) for frame in frames]
    print('Filtering contour coverage with confidence rejection...', flush=True)
    for index, frame in enumerate(frames):
        previous = (index - 1) % len(frames)
        neighbors = [align_neighbor(frames[previous], backward[previous], forward[previous]), align_neighbor(frames[(index + 1) % len(frames)], forward[index], backward[index])]
        result.append(filter_matte(frame, neighbors))
    before = measure(frames, forward, backward, bands)
    after = measure(result, forward, backward, bands)
    preview_height = 220
    preview_width = 2 * round(width * preview_height / height / 2)
    try:
        encode(result, temporary[0], fps, master=True)
        encode([downsample(frame, preview_width, preview_height) for frame in result], temporary[1], fps)
        encode([downsample(frame, preview_width, preview_height) for frame in frames], temporary[2], fps)
        for transient, destination in zip(temporary, destinations):
            transient.rename(destination)
        report.write_text(json.dumps({
            'source': str(source.resolve()), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'frames': len(frames), 'fps': float(fps), 'previewSize': [preview_width, preview_height],
            'method': 'circular 3-frame motion-compensated alpha-only contour filter; original RGB retained except newly visible edge pixels',
            'confidence': 'bidirectional flow closure sigma 0.75px, color RMS <0.18, alpha disagreement <0.35',
            'neighborWeight': 0.5, 'spatialGaussian': False, 'before': before, 'after': after,
            'visualAcceptance': 'Pending. Metrics can improve by softening; inspect sharpness, ghosting and genuine shape changes.',
        }, indent=2) + '\n')
        print(report.read_text())
    finally:
        for path in temporary:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build an offline temporal contour-matte comparison for the looped GPT video.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.output)
