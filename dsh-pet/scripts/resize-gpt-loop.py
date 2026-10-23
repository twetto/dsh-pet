import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image


spec = importlib.util.spec_from_file_location('sample_gpt_video', Path(__file__).with_name('sample-gpt-video.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def prepare(source, output):
    output.mkdir(parents=True, exist_ok=True)
    destinations = {height: output / f'idle-loop-{height}-v8.webp' for height in [516, 344]}
    report = output / 'resolutions-v8.json'
    if any(path.exists() for path in [*destinations.values(), report]):
        raise FileExistsError('Resolution outputs already exist')
    sizes = {}
    with Image.open(source) as animation:
        for height, destination in destinations.items():
            width = round(animation.width * height / animation.height)
            sizes[str(height)] = [width, height]
            temporary = destination.with_suffix('.partial.webp')
            encoder = subprocess.Popen([
                'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
                '-s', f'{width}x{height}', '-r', '24', '-i', '-', '-an',
                '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary),
            ], stdin=subprocess.PIPE)
            try:
                for frame_index in range(animation.n_frames):
                    animation.seek(frame_index)
                    frame = np.asarray(animation.convert('RGBA'))
                    encoder.stdin.write(module.resize_coverage(frame, width, height).tobytes())
                encoder.stdin.close()
                if encoder.wait() != 0:
                    raise RuntimeError('Resolution comparison encode failed')
                temporary.rename(destination)
            finally:
                if not encoder.stdin.closed:
                    encoder.stdin.close()
                if encoder.poll() is None:
                    encoder.terminate()
                encoder.wait()
                temporary.unlink(missing_ok=True)
        report.write_text(json.dumps({
            'source': str(source.resolve()), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sourceSize': list(animation.size), 'sizes': sizes,
            'frames': animation.n_frames, 'fps': 24,
            'method': 'Each variant independently resized once from the accepted finished loop; premultiplied RGBA area sampling; lossless WebP.',
            'visualAcceptance': 'Pending: same logical display size, inspect contour shimmer against 688px keeper.',
        }, indent=2) + '\n')
        print(report.read_text())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Downsample the finished 24 fps loop once, after full-resolution keying and motion processing.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.output)
