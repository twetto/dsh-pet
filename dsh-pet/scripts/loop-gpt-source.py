import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np
from PIL import Image


spec = importlib.util.spec_from_file_location('loop_gpt_video', Path(__file__).with_name('loop-gpt-video.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def gray(frame):
    pixels = module.premultiply(frame)
    rgb = pixels[:, :, :3] + 0.5 * (1 - pixels[:, :, 3:4])
    return cv2.cvtColor(np.clip(rgb * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)


def prepare(source, destination, bridge_frames=12):
    report = destination.with_suffix('.json')
    if destination.exists() or report.exists():
        raise FileExistsError('Loop outputs already exist')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.partial.webp')
    with Image.open(source) as animation:
        width, height = animation.size
        small = []
        for frame_index in range(animation.n_frames):
            animation.seek(frame_index)
            small.append(cv2.resize(module.premultiply(np.asarray(animation.convert('RGBA'))), (96, 96), interpolation=cv2.INTER_AREA))
        start, end, score = module.choose_small_endpoints(np.stack(small), 24)
        animation.seek(end)
        last = np.asarray(animation.convert('RGBA')).copy()
        animation.seek(start)
        first = np.asarray(animation.convert('RGBA')).copy()
        estimator = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        forward = estimator.calc(gray(last), gray(first), None)
        backward = estimator.calc(gray(first), gray(last), None)
        encoder = subprocess.Popen([
            'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s', f'{width}x{height}', '-r', '24', '-i', '-', '-an',
            '-c:v', 'libwebp_anim', '-lossless', '1', '-loop', '0', str(temporary),
        ], stdin=subprocess.PIPE)
        try:
            for frame_index in range(start, end + 1):
                animation.seek(frame_index)
                encoder.stdin.write(animation.convert('RGBA').tobytes())
            for bridge_index in range(1, bridge_frames + 1):
                frame = module.warp_between(last, first, forward, backward, bridge_index / (bridge_frames + 1))
                encoder.stdin.write(frame.tobytes())
            encoder.stdin.close()
            if encoder.wait() != 0:
                raise RuntimeError('Full-resolution loop encode failed')
            temporary.rename(destination)
            report.write_text(json.dumps({
                'source': str(source.resolve()), 'size': [width, height],
                'retainedFrameRangeInclusive': [start, end], 'bridgeFrames': bridge_frames,
                'frames': end - start + 1 + bridge_frames, 'fps': 24,
                'durationSeconds': (end - start + 1 + bridge_frames) / 24,
                'endpointSearchScore': score,
                'flow': 'Full-resolution OpenCV DIS medium, bidirectional premultiplied warp/blend.',
                'method': 'Retained frames unchanged; 12 synthesized bridge frames; lossless WebP; no asset resizing or AA.',
                'visualAcceptance': 'Pending: inspect seam, hair/wing distortion and changes in shimmer.',
            }, indent=2) + '\n')
            print(report.read_text())
        finally:
            if not encoder.stdin.closed:
                encoder.stdin.close()
            if encoder.poll() is None:
                encoder.terminate()
            encoder.wait()
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Restore the optical-flow loop without downsampling the 24 fps source.')
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.destination)
