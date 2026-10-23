# Finished-loop resolution comparison

User accepted the full-resolution 728x688 loop as gorgeous; retain that keeper
unchanged in `../video-source-v7/idle-looped-v7.webp`.

These variants each take one independent premultiplied-RGBA area downsample
from that finished loop, AFTER keying, stabilization and optical-flow processing:

- 546x516: `idle-loop-516-v8.webp`
- 364x344: `idle-loop-344-v8.webp`

Both preserve all 187 frames at 24 fps and use lossless animated WebP. No extra
AA or temporal filtering. Unlike early v3/v6 experiments, neither variant keys
or computes motion at a reduced resolution. Display size stays unchanged;
visual shimmer acceptance is pending. Smaller dimensions imply less decoded
pixel storage, but actual playback CPU/memory improvements are not measured.

```sh
python3 scripts/resize-gpt-loop.py assets/gpt-girl/video-source-v7/idle-looped-v7.webp assets/gpt-girl/video-resolutions-v8
```

Preview IPC `video matte looped` (688), `video matte loop516`, `video matte loop344`.
Right-click the video preview cycles 688 → 516 → 344 → 688, restarting playback.
Left drag remains unchanged. Title suffix identifies the selected variant.
This comparison control is only on the separate video preview, not the main pet.
