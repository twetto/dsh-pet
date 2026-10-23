import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


def resize_coverage(frame, width, height):
    if frame.shape[:2] == (height, width):
        return frame.copy()
    pixels = frame.astype(np.float32) / 255
    pixels[:, :, :3] *= pixels[:, :, 3:4]
    pixels = cv2.resize(pixels, (width, height), interpolation=cv2.INTER_AREA)
    pixels[:, :, :3] /= np.maximum(pixels[:, :, 3:4], 1e-6)
    pixels[pixels[:, :, 3] == 0] = 0
    return np.clip(pixels * 255, 0, 255).round().astype(np.uint8)


def prepare(source, output, physical_height=275):
    if physical_height < 1:
        raise ValueError('Physical height must be positive')
    details = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', str(source)]))['streams'][0]
    width, height = details['width'], details['height']
    fps = Fraction(details['r_frame_rate'])
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 4)
    sizes = {'master': [width, height], 'native': [round(width * physical_height / height), physical_height]}
    output.mkdir(parents=True, exist_ok=True)
    destinations = {name: output / f'idle-{name}-v6.webp' for name in sizes}
    report = output / 'sampling-v6.json'
    if any(path.exists() for path in [*destinations.values(), report]):
        raise FileExistsError('Sampling outputs already exist; choose a new directory')
    for name, size in sizes.items():
        temporary = destinations[name].with_suffix('.partial.webp')
        process = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{size[0]}x{size[1]}', '-r', str(fps), '-i', '-', '-an', '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary)], stdin=subprocess.PIPE)
        try:
            for frame in frames:
                process.stdin.write(resize_coverage(frame, *size).tobytes())
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError('Sampling comparison encode failed')
            temporary.rename(destinations[name])
        finally:
            if not process.stdin.closed:
                process.stdin.close()
            if process.poll() is None:
                process.terminate()
            process.wait()
            temporary.unlink(missing_ok=True)
    report.write_text(json.dumps({
        'source': str(source.resolve()), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'frames': len(frames), 'fps': float(fps), 'sizes': sizes,
        'method': 'Master: no resize. Native: one premultiplied area resize. Neither has spatial or temporal filtering.',
        'target': '275 physical pixels corresponds to 220 logical pixels at 1.25 display scale; other sizes require re-evaluation.',
        'limitation': 'The 344px master already includes the original 1280x720 to 640x360 processing resize; this test does not undo that loss.',
    }, indent=2) + '\n')
    print(report.read_text())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Prepare unfiltered master/native-resolution playback for sampling comparison.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--physical-height', type=int, default=275)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.output, arguments.physical_height)
