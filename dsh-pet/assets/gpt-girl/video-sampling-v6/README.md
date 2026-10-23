# Sampling investigation v6

User sees no improvement from temporal matte filtering and suspects downsampling.
The current video preview defaults to `master`, with no spatial Gaussian or
temporal matte filter. Motion, stabilization, 189 frames / 24fps and the flow loop
are unchanged. The v3 motion master and older comparisons remain untouched.

- `idle-master-v6.webp`: 364x344 lossless playback with NO additional asset resize.
- `idle-native-v6.webp`: 291x275, one premultiplied area resize for comparison.
- Existing `control`: 232x220, matched unfiltered area-resized playback from v5b.
- Existing `temporal`: v5b temporal candidate, not accepted perceptually.

At the current 256x244 window size, the character draws about 232.8x220 logical
pixels. Niri's output scale is 1.25, nominally about 291x275 display pixels.
However, Qt's attached Screen reports a ratio of 2, not 1.25. Do NOT claim that
the 275px asset is necessarily sampled 1:1 by Qt: screen ratio, actual window
backing-buffer scale, and final compositor output are distinct quantities.
The name `native` is historical for the display-resolution experiment, not proof
of native buffer matching. IPC exposes the Qt-reported scale and logical image
dimensions; `screenScaledSizeEstimate` is an estimate, not measured buffer size.

The old 220px asset was below the nominal 275px display height. Using the 344px
master removes that particular pre-downsample step, but does NOT undo the earlier
1280x720 → 640x360 processing resize or prove that resampling caused the shimmer.
Sharper source assets can also reveal genuine generated detail variation.

The old procedural pilot and video window bounds were also overlapping. The old
pilot was moved aside, without changing the video window or DeepSeek. Visibility
of the old pilot's actual pixels was not established, so overlapping geometry
alone is not proof that the two rendered silhouettes caused the reported shimmer.

## Same-motion comparison

```sh
qs ipc -p runtime/quickshell/gpt-video/shell.qml call video matte master
qs ipc -p runtime/quickshell/gpt-video/shell.qml call video matte native
qs ipc -p runtime/quickshell/gpt-video/shell.qml call video matte control
```

Each selection restarts at frame zero. Avoid resizing/moving the window while
comparing. Default and current selection is master; visual acceptance is pending.
Both new assets have 189 transparent frames and preserve original timing.

Reproduce (Python 3, NumPy, OpenCV, FFmpeg):

```sh
python3 scripts/sample-gpt-video.py \
  assets/gpt-girl/video-loop-v3/idle-gemini-loop-v2.webm assets/gpt-girl/video-sampling-next
python3 scripts/tests/gpt-video.test.py
```

`sampling-v6.json` records source hash and asset sizes. Its 275px target refers to
the measured niri output scale, not Qt's reported Screen ratio.
