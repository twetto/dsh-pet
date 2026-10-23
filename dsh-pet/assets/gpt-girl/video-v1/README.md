# Gemini-generated idle: first conversion

The separate desktop video preview now uses smoothed optical-flow loop v3; this directory
retains the original unlooped conversion for comparison and reproduction.

User-generated source: `~/Pictures/GPT_avatar/gemini_generated_video_5bd7d277.mp4`.
The source is unchanged and not copied into the repository. Its SHA-256, exact
output dimensions, frame count and processing parameters are in `idle-gemini-v1.json`.
The exact generation model and prompt are not verified from the MP4 metadata.

- Input: 1280x720 H.264, 24fps, about 10s, with green background and AAC audio.
- Alpha master: `idle-gemini-v1.webm`, VP9 alpha, 364x344, 24fps, 240 frames.
- Quickshell playback: `idle-gemini-v1.webp`, lossless animated WebP, 220px high.
- Audio is omitted from both outputs.

Processing uses a green-excess matte, estimated background-color unmixing for
partly transparent edge pixels, one fixed union crop, and per-frame vertical
baseline stabilization (0–5 pixels at the 360p processing size). White and lavender
regions are preserved. Horizontal framing is not stabilized against the moving
tail, so tail motion does not cause whole-character translation.

The original motion order and all 240 frames are retained. No shader motion,
crossfade, reverse/ping-pong playback, frame interpolation or artificial loop fix
is added. The first/last poses and tail differ; loop continuity is NOT established.
Inspect the wrap around ten seconds, green fringes, hair holes, baseline jitter,
and character consistency before replacing the accepted procedural preview.

## Reproduce

Requires Python 3, NumPy, OpenCV and FFmpeg with libvpx-vp9 / libwebp_anim:

```sh
python3 scripts/prepare-gpt-video.py \
  ~/Pictures/GPT_avatar/gemini_generated_video_5bd7d277.mp4 assets/gpt-girl/video-v2
python3 scripts/tests/gpt-video.test.py
```

The converter refuses to overwrite outputs. Green thresholds are tuned for this
clip, not a general segmentation model. It assumes a clear top-left background
sample and that the lowest opaque silhouette point is the feet, not a prop/tail.

## Separate preview

```sh
QT_QPA_PLATFORM=wayland qs -n -p runtime/quickshell/gpt-video/shell.qml
qs ipc -p runtime/quickshell/gpt-video/shell.qml call video status
```

No service, menu, click reaction or dangling pose is connected. Native left-drag
is retained. This separate window leaves the blink/breath procedural pilot and
DeepSeek unchanged. The known niri transparent-margin limitation also applies.
