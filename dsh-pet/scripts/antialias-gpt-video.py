import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


def antialias_frame(frame, width, height):
    pixels = frame.astype(np.float32) / 255
    pixels[:, :, :3] *= pixels[:, :, 3:4]
    pixels = cv2.resize(pixels, (width, height), interpolation=cv2.INTER_AREA)
    alpha = pixels[:, :, 3]
    kernel = np.ones((3, 3), dtype=np.uint8)
    boundary = cv2.dilate(alpha, kernel) - cv2.erode(alpha, kernel) > 0.02
    softened = cv2.GaussianBlur(pixels, (3, 3), 0.45, borderType=cv2.BORDER_CONSTANT)
    pixels = np.where(boundary[:, :, None], softened, pixels)
    pixels[:, :, :3] /= np.maximum(pixels[:, :, 3:4], 1e-6)
    pixels[pixels[:, :, 3] == 0] = 0
    return np.clip(pixels * 255, 0, 255).round().astype(np.uint8)


def prepare(source, output):
    details = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', str(source)]))['streams'][0]
    source_width, source_height = details['width'], details['height']
    fps = Fraction(details['r_frame_rate'])
    height = 220
    width = 2 * round(source_width * height / source_height / 2)
    output.mkdir(parents=True, exist_ok=True)
    preview = output / 'idle-gemini-aa-v4.webp'
    report = output / 'idle-gemini-aa-v4.json'
    if preview.exists() or report.exists():
        raise FileExistsError('Outputs already exist; choose a new output directory')
    temporary = preview.with_suffix('.partial.webp')
    decoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], stdout=subprocess.PIPE)
    encoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}', '-r', str(fps), '-i', '-', '-an', '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary)], stdin=subprocess.PIPE)
    count = 0
    frame_size = source_width * source_height * 4
    try:
        while True:
            data = bytearray()
            while len(data) < frame_size:
                chunk = decoder.stdout.read(frame_size - len(data))
                if not chunk:
                    break
                data.extend(chunk)
            if not data:
                break
            if len(data) != frame_size:
                raise RuntimeError('Incomplete source frame')
            frame = np.frombuffer(data, dtype=np.uint8).reshape(source_height, source_width, 4)
            encoder.stdin.write(antialias_frame(frame, width, height).tobytes())
            count += 1
        encoder.stdin.close()
        decoder_status = decoder.wait()
        encoder_status = encoder.wait()
        if decoder_status != 0 or encoder_status != 0 or not count:
            raise RuntimeError('Anti-alias conversion failed')
        temporary.rename(preview)
        report.write_text(json.dumps({
            'source': str(source.resolve()), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'frames': count, 'fps': float(fps), 'size': [width, height],
            'method': 'premultiplied RGBA area downsample; contour-only 3x3 Gaussian sigma 0.45px; unpremultiply',
            'motion': 'Unchanged frame order, timing and optical-flow bridge',
            'visualAcceptance': 'Pending: check contour softness on both light and dark backgrounds',
        }, indent=2) + '\n')
        print(report.read_text())
    finally:
        decoder.stdout.close()
        if not encoder.stdin.closed:
            encoder.stdin.close()
        for process in (decoder, encoder):
            if process.poll() is None:
                process.terminate()
            process.wait()
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Prepare lightly anti-aliased contour playback from the alpha video master.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.output)
