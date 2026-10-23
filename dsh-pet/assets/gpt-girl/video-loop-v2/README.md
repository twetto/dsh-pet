# Optical-flow loop v2

Archived comparison: the current preview uses `../video-loop-v3/`, with smoothed
subpixel stabilization followed by the same optical-flow loop construction.

Source is the keyed/stabilized v1 alpha master; source MP4 and v1 outputs are
unchanged. This was the first loop shown in the separate video preview.

Endpoint search retained original decoded frames 20–196 inclusive, prioritizing
similar appearance and velocity with increased head-region weight. Twelve new
motion-compensated frames bridge frame 196 back to frame 20. Final length is 189
frames / 7.875 seconds at 24fps. Original interior motion is not interpolated.

The bridge uses OpenCV DIS medium bidirectional dense optical flow, inverse-map
warping of both endpoint images, and weighted combination AFTER alignment. All
warps/compositing operate on premultiplied RGBA to preserve transparent edges.
This is not a plain unaligned crossfade, but can still ghost or distort occlusions.
No AI model, remote API or additional paid generation was used.

Pre-encode boundary mean absolute premultiplied-RGBA change dropped from 12.185
to 0.973 (0–255 scale), versus 2.472 median adjacent-frame change in v2. This measures
boundary appearance only, NOT naturalness, velocity continuity or absence of flow
artifacts. Inspect hair, wing tips, face and feet across the last half-second.
Full parameters and frame ranges are in `idle-gemini-loop-v2.json`.

Reproduce into a new output directory (Python 3, NumPy, OpenCV, FFmpeg required):

```sh
python3 scripts/loop-gpt-video.py \
  assets/gpt-girl/video-v1/idle-gemini-v1.webm assets/gpt-girl/video-loop-v3
python3 scripts/tests/gpt-video.test.py
```

The converter assumes the input is the 24fps alpha VP9 master. It refuses to
overwrite final outputs. The first version remains available for comparison.
