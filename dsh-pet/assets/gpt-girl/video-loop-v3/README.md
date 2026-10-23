# Smoothed stabilization and flow loop v3

Current motion master; desktop playback uses the v4 anti-aliased derivative.
Generated from the unchanged user MP4, with v1/v2
retained for comparison. The filenames retain converter defaults; this version is
identified by its directory, not the `v2` suffix of individual loop files.

Preparation in `../video-smooth-v3/` filters the integer foot-correction trajectory
with a normalized Gaussian (sigma 2 frames, radius 6). Fractional translations are
then applied using OpenCV bilinear affine resampling in premultiplied RGBA, avoiding
dark transparent edges. Whole-character position corrections now ramp rather than
snap. Actual generated breathing/deformation is not removed.

- Maximum correction change: 1px → 0.217px per frame at 360p processing size.
- Maximum residual baseline deviation before encoding: 0.402px at 360p.
- Master crop remains 364x344; playback remains 220px high with a 12px baseline.
- Flow loop retains source frames 20–196 and a 12-frame bidirectional bridge.
- Playback length remains 189 frames / 7.875s at 24fps; no audio or shader motion.
- Pre-encode boundary premultiplied-RGBA MAE: 0.917; normal adjacent median: 2.159.

These are processing diagnostics, not proof that all perceived wobble is gone.
Inspect body breathing, edge softness, foot contact and bridge warping visually.

Reproduce into fresh directories (Python 3, NumPy, OpenCV and FFmpeg):

```sh
python3 scripts/prepare-gpt-video.py \
  ~/Pictures/GPT_avatar/gemini_generated_video_5bd7d277.mp4 assets/gpt-girl/video-smooth-next --smooth
python3 scripts/loop-gpt-video.py \
  assets/gpt-girl/video-smooth-next/idle-gemini-v1.webm assets/gpt-girl/video-loop-next
python3 scripts/tests/gpt-video.test.py
```

Without `--smooth`, the preparation script retains its old integer-stabilization
mode for reproducibility. Neither converter overwrites existing final outputs.
