import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image


spec = importlib.util.spec_from_file_location('prepare_gpt_video', Path(__file__).with_name('prepare-gpt-video.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def foot_baseline(frame):
    rows = np.flatnonzero(np.any(frame[:, :, 3] >= 128, axis=1))
    if not rows.size:
        raise ValueError('Frame has no foreground')
    return int(rows[-1]) + 1


def prepare(source, destination):
    report = destination.with_suffix('.json')
    if destination.exists() or report.exists():
        raise FileExistsError('Stabilization outputs already exist')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.partial.webp')
    with Image.open(source) as animation:
        width, height = animation.size
        baselines = []
        for frame_index in range(animation.n_frames):
            animation.seek(frame_index)
            baselines.append(foot_baseline(np.asarray(animation.convert('RGBA'))))
        shifts = max(baselines) - np.asarray(baselines, dtype=float)
        corrections = module.smooth_corrections(shifts)
        encoder = subprocess.Popen([
            'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s', f'{width}x{height}', '-r', '24', '-i', '-', '-an',
            '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary),
        ], stdin=subprocess.PIPE)
        try:
            for frame_index in range(animation.n_frames):
                animation.seek(frame_index)
                frame = np.asarray(animation.convert('RGBA'))
                stabilized = module.translate_subpixel(frame, 0, corrections[frame_index], width, height)
                encoder.stdin.write(stabilized.tobytes())
            encoder.stdin.close()
            if encoder.wait() != 0:
                raise RuntimeError('Stabilized source encode failed')
            temporary.rename(destination)
            report.write_text(json.dumps({
                'source': str(source.resolve()), 'size': [width, height],
                'frames': animation.n_frames, 'fps': 24,
                'method': 'Vertical baseline shifts smoothed with sigma-2-frame Gaussian; premultiplied bilinear translation only.',
                'baselineRange': [min(baselines), max(baselines)],
                'maxCorrectionStep': float(np.max(np.abs(np.diff(corrections)))),
                'maxResidualBaselineError': float(np.max(np.abs(corrections - shifts))),
                'corrections': corrections.tolist(),
                'limitation': 'No resize, AA or seamless loop. Subpixel translation resamples pixels and may change shimmer.',
            }, indent=2) + '\n')
            print(f'{animation.n_frames} stabilized frames at {width}x{height}, 24 fps')
        finally:
            if not encoder.stdin.closed:
                encoder.stdin.close()
            if encoder.poll() is None:
                encoder.terminate()
            encoder.wait()
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Stabilize the full-resolution keyed 24 fps control without resizing.')
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.destination)
