# Light contour anti-aliasing v4

Archived: user identified temporal shimmer rather than spatial jaggies. This
softening was removed from active playback; current experiment is `../video-temporal-v5b/`.

Former desktop video playback. Uses the unchanged v3 stabilized/flow-loop alpha
master, retaining all 189 frames and timing (24fps, about 7.875 seconds).

Playback is 232x220 lossless animated WebP. Downsampling is performed on
premultiplied RGBA with area coverage rather than independently scaling straight
RGB and alpha. A 3x3 Gaussian with sigma 0.45 playback pixels is applied only in
the silhouette's one-pixel alpha-transition neighborhood. Interior opaque face,
hair and costume details do not receive that blur. Filtering premultiplied color
alongside coverage avoids introducing dark fringes into white/lavender edges.

No additional stabilization, new motion, optical flow, crossfade or frame
interpolation is applied here. QML still uses smooth filtering. Previous playback
versions and the full alpha master remain available. Visual acceptance of contour
softness on dark/light desktop backgrounds is pending.

Reproduce into a fresh directory (Python 3, NumPy, OpenCV, FFmpeg):

```sh
python3 scripts/antialias-gpt-video.py \
  assets/gpt-girl/video-loop-v3/idle-gemini-loop-v2.webm assets/gpt-girl/video-aa-next
python3 scripts/tests/gpt-video.test.py
```

The converter refuses to overwrite final outputs. Source hash and processing
details are in `idle-gemini-aa-v4.json`. Tests cover contour coverage, alpha-safe
color filtering and preservation of interior features, alongside prior pipeline
regressions. Anti-aliasing cannot recover fine detail missing from the source.
