import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import cv2


def smooth_corrections(shifts):
    values = np.asarray(shifts, dtype=np.float64)
    if not values.size:
        raise ValueError('No stabilization samples')
    positions = np.arange(-6, 7, dtype=np.float64)
    kernel = np.exp(-0.5 * (positions / 2) ** 2)
    kernel /= kernel.sum()
    return np.convolve(np.pad(values, 6, mode='edge'), kernel, mode='valid')


def translate_subpixel(rgba, offset_x, offset_y, width, height):
    pixels = rgba.astype(np.float32) / 255
    pixels[:, :, :3] *= pixels[:, :, 3:4]
    transform = np.array([[1, 0, offset_x], [0, 1, offset_y]], dtype=np.float32)
    shifted = cv2.warpAffine(pixels, transform, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    shifted[:, :, :3] /= np.maximum(shifted[:, :, 3:4], 1e-6)
    shifted[shifted[:, :, 3] == 0] = 0
    return np.clip(shifted * 255, 0, 255).round().astype(np.uint8)


def key_frame(frame):
    pixels = frame.astype(np.float32)
    excess = pixels[:, :, 1] - np.maximum(pixels[:, :, 0], pixels[:, :, 2])
    alpha = 1 - np.clip((excess - 8) / 42, 0, 1)
    background = np.median(pixels[:40, :80].reshape(-1, 3), axis=0)
    recovered = (pixels - (1 - alpha[:, :, None]) * background) / np.maximum(alpha[:, :, None], 0.02)
    recovered[alpha == 0] = 0
    return np.concatenate((np.clip(recovered, 0, 255), alpha[:, :, None] * 255), axis=2).astype(np.uint8)


def frames(source):
    process = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-i', str(source), '-an', '-vf', 'fps=24,scale=640:360',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], stdout=subprocess.PIPE)
    frame_size = 640 * 360 * 3
    try:
        while True:
            data = bytearray()
            while len(data) < frame_size:
                chunk = process.stdout.read(frame_size - len(data))
                if not chunk:
                    break
                data.extend(chunk)
            if not data:
                break
            if len(data) != frame_size:
                raise RuntimeError('Incomplete decoded video frame')
            yield np.frombuffer(data, dtype=np.uint8).reshape(360, 640, 3)
        if process.wait() != 0:
            raise RuntimeError('Video decode failed')
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
        process.wait()


def prepare(source, output, smooth=False):
    boxes = []
    for frame in frames(source):
        alpha = key_frame(frame)[:, :, 3]
        rows, columns = np.where(alpha >= 128)
        if not rows.size:
            raise RuntimeError('Frame has no foreground')
        boxes.append((int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1))
    if not boxes:
        raise RuntimeError('Video has no frames')
    floor = max(box[3] for box in boxes)
    shifts = [floor - box[3] for box in boxes]
    applied_shifts = smooth_corrections(shifts) if smooth else np.asarray(shifts, dtype=float)
    left = min(box[0] for box in boxes) - 8
    top = min(box[1] + shift for box, shift in zip(boxes, shifts)) - 8
    width = max(box[2] for box in boxes) + 8 - left
    height = floor + 8 - top
    width += width % 2
    height += height % 2
    output.mkdir(parents=True, exist_ok=True)
    master = output / 'idle-gemini-v1.webm'
    preview = output / 'idle-gemini-v1.webp'
    report = output / 'idle-gemini-v1.json'
    if any(path.exists() for path in (master, preview, report)):
        raise FileExistsError('Outputs already exist; choose a new output directory')
    temporary_master = master.with_name('idle-gemini-v1.partial.webm')
    temporary_preview = preview.with_name('idle-gemini-v1.partial.webp')
    encoder = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
        '-s', f'{width}x{height}', '-r', '24', '-i', '-', '-an',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
        '-crf', '20', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', str(temporary_master),
        '-an', '-vf', 'scale=-2:220', '-c:v', 'libwebp_anim', '-lossless', '1',
        '-loop', '0', str(temporary_preview),
    ], stdin=subprocess.PIPE)
    completed = False
    try:
        count = 0
        for count, frame in enumerate(frames(source), start=1):
            rgba = key_frame(frame)
            offset_x = -left
            if smooth:
                canvas = translate_subpixel(rgba, offset_x, applied_shifts[count - 1] - top, width, height)
            else:
                canvas = np.zeros((height, width, 4), dtype=np.uint8)
                offset_y = shifts[count - 1] - top
                source_left = max(0, -offset_x)
                source_top = max(0, -offset_y)
                source_right = min(640, width - offset_x)
                source_bottom = min(360, height - offset_y)
                canvas[source_top + offset_y:source_bottom + offset_y, source_left + offset_x:source_right + offset_x] = rgba[source_top:source_bottom, source_left:source_right]
            encoder.stdin.write(canvas.tobytes())
        encoder.stdin.close()
        if encoder.wait() != 0 or count != len(boxes):
            raise RuntimeError('Video encode failed or frame count changed')
        temporary_master.rename(master)
        temporary_preview.rename(preview)
        report.write_text(json.dumps({
            'source': str(source.resolve()), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'frames': count, 'fps': 24, 'durationSeconds': count / 24,
            'masterSize': [width, height], 'previewHeight': 220, 'audioRemoved': True,
            'greenExcessThresholds': [8, 50], 'footShiftRangePixelsAt360p': [min(shifts), max(shifts)],
            'stabilization': 'Gaussian sigma=2 frames, 13-sample kernel, premultiplied subpixel affine' if smooth else 'integer per-frame baseline lock',
            'maxAppliedCorrectionStepPixelsAt360p': float(np.max(np.abs(np.diff(applied_shifts)))) if len(applied_shifts) > 1 else 0,
            'maxResidualFootOffsetPixelsAt360p': float(np.max(np.abs(applied_shifts - np.asarray(shifts)))),
            'cropOriginAt360p': [left, top], 'footBaselineInMaster': floor - top,
            'loop': 'Unmodified motion order; boundary continuity needs visual acceptance. No crossfade.',
        }, indent=2) + '\n')
        completed = True
        print(report.read_text())
    finally:
        if not encoder.stdin.closed:
            encoder.stdin.close()
        if encoder.poll() is None:
            encoder.terminate()
        encoder.wait()
        if not completed:
            temporary_master.unlink(missing_ok=True)
            temporary_preview.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Prepare the green-screen GPT idle clip without changing its motion.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--smooth', action='store_true', help='Use temporally smoothed subpixel baseline corrections')
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.output, smooth=arguments.smooth)
