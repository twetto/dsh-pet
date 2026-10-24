# Claude idle video — first processing pass

Original `../gemini_generated_video_e3fe7722.mp4` is untouched: 1280x720,
240 frames at 24 fps. All-frame foreground union: x454..828, y138..584.
Foot baseline varies from y580 to y584. The source includes a brief mouth
movement; processing does not replace facial expressions.

Pipeline, using the existing scripts from the package directory:

1. Fixed integer crop, 460x540 at x410, y90, lossless `source.webp`.
2. `key-gpt-source.py source.webp keyed.webp`: full-resolution green removal
   and background unmixing.
3. `stabilize-gpt-source.py keyed.webp stabilized.webp`: smoothed vertical
   foot-baseline correction in premultiplied RGBA, without resizing.
4. `loop-gpt-source.py stabilized.webp looped.webp`: native-resolution optical
   flow bridge; selected range and duration are recorded in `looped.json`.
5. `resize-gpt-loop.py looped.webp resolutions`: independent 516px and 344px
   final downsampling using premultiplied area sampling, lossless WebP.

The resolution filenames retain v8 from the reused GPT script, not eight Claude
iterations. Original video and full-size controls remain local. Visual
acceptance: user approved the loop. Available as Claude in the main selector.

Temporary standalone animation-only preview: `/tmp/claude-idle-preview-v1.qml`.
No Claude chat integration is provided by this preview.
