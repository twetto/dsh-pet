# Motion-compensated temporal matte experiment v5b

Archived experiment: user saw no perceptual improvement. Current preview defaults
to the unresized master in `../video-sampling-v6/`. The previous spatial Gaussian
softening is removed. Source motion, stabilization, frame order, timing and the
existing optical-flow loop bridge are unchanged (189 frames, 24fps, 7.875s).

## Method

Using the v3 alpha master, estimate bidirectional DIS medium flow between each
adjacent frame, including the wrap. Align previous/next frames to the current
frame. Filter alpha coverage only within a one-pixel contour neighborhood, with
the current frame weighted 1 and each neighbor at most 0.5. Confidence rejects
inconsistent forward/backward flow (sigma 0.75px), large color mismatch (RMS 0.18),
and coverage disagreement (0.35). This avoids simply averaging unaligned silhouettes.

Current-frame RGB remains unchanged except for newly visible low-coverage pixels,
which borrow aligned edge color to prevent black fringes. Opaque interior RGB is
bit-identical in the candidate/control lossless playback files. Both use the same
premultiplied area downsample to 232x220; neither adds spatial Gaussian blur.
The control therefore isolates temporal filtering, rather than also changing the
resampling method. It is not byte-identical to the older FFmpeg-scaled v3 WebP.

- `idle-temporal-v5.webp`: candidate playback.
- `idle-control-v5.webp`: matched unfiltered playback.
- `idle-temporal-v5.webm`: filtered alpha master (lossy VP9 encoding).
- `idle-temporal-v5.json`: parameters, source hash and metrics.

Motion-aligned edge-alpha variation decreased from 0.049710 to 0.043143 (~13.2%).
Mean edge-gradient magnitude changed from 1.7960 to 1.7753 (~1.15% lower).
These offline proxies are not proof that perceived shimmer or ghosting is solved.
Temporal filtering still trades a little coverage sharpness for stability; genuine
AI-generated contour/line-art changes cannot be fully fixed by alpha filtering.
Inspect hair, wings, face, feet and the wrap on light and dark backgrounds.

## A/B without a second pet window

```sh
qs ipc -p runtime/quickshell/gpt-video/shell.qml call video matte control
qs ipc -p runtime/quickshell/gpt-video/shell.qml call video matte temporal
```

This restarts the selected clip from frame zero. Both files have 189 frames at the
same size/timing, so compare the same phase of the motion. IPC status reports the
selected matte and `spatialGaussian: false`. Previous versions remain archived.

Reproduce into a fresh directory (Python 3, NumPy, OpenCV, FFmpeg):

```sh
python3 scripts/temporal-gpt-video.py \
  assets/gpt-girl/video-loop-v3/idle-gemini-loop-v2.webm assets/gpt-girl/video-temporal-next
python3 scripts/tests/gpt-video.test.py
```

Eleven Python pipeline tests include correct flow direction, reverse consistency,
matte-noise suppression, unchanged interior colors, occlusion rejection, and
new-edge color recovery. The discarded first offline build is marked in v5; only
this corrected v5b was selected for the live preview. Visual acceptance is pending.
