import argparse
import importlib.util
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image


def prepare(source, destination):
    spec = importlib.util.spec_from_file_location('prepare_gpt_video', Path(__file__).with_name('prepare-gpt-video.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.partial.webp')
    with Image.open(source) as animation:
        width, height = animation.size
        encoder = subprocess.Popen([
            'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s', f'{width}x{height}', '-r', '24', '-i', '-', '-an',
            '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary),
        ], stdin=subprocess.PIPE)
        try:
            for frame_index in range(animation.n_frames):
                animation.seek(frame_index)
                encoder.stdin.write(module.key_frame(np.asarray(animation.convert('RGB'))).tobytes())
            encoder.stdin.close()
            if encoder.wait() != 0:
                raise RuntimeError('Source key encode failed')
            temporary.rename(destination)
            print(f'{animation.n_frames} keyed frames at {width}x{height}, 24 fps')
        finally:
            if not encoder.stdin.closed:
                encoder.stdin.close()
            if encoder.poll() is None:
                encoder.terminate()
            encoder.wait()
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Key the lossless 24 fps source control without resizing or motion changes.')
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.destination)
