# Gemini normal idle — first video pipeline

Original: `../gemini_generated_video_ea120d47.mp4`, unchanged, 1280x720,
240 frames at 24 fps. All-frame foreground bounds: x434..884, y122..590.
The foot baseline varies by only one pixel; no stabilization is applied.

Processing order:

1. Fixed integer crop: 520x550 at x400, y80. Lossless `source.webp`.
2. Existing `scripts/key-gpt-source.py`: full-resolution green removal and
   background-color unmix, saved as `keyed.webp`.
3. Existing `scripts/loop-gpt-source.py`: retain frames 0..221, synthesize a
   12-frame bidirectional optical-flow bridge. `looped.webp` is 9.75 seconds.
4. Existing `scripts/resize-gpt-loop.py`: independently resize the full loop
   once to 516px and 344px using premultiplied area sampling, lossless WebP.

Commands run from the package directory:

```sh
ffmpeg -i assets/gemini-girl/gemini_generated_video_ea120d47.mp4 -vf 'crop=520:550:400:80' -an -c:v libwebp_anim -lossless 1 -loop 0 assets/gemini-girl/idle-processing-v1/source.webp
python3 scripts/key-gpt-source.py assets/gemini-girl/idle-processing-v1/source.webp assets/gemini-girl/idle-processing-v1/keyed.webp
python3 scripts/loop-gpt-source.py assets/gemini-girl/idle-processing-v1/keyed.webp assets/gemini-girl/idle-processing-v1/looped.webp
python3 scripts/resize-gpt-loop.py assets/gemini-girl/idle-processing-v1/looped.webp assets/gemini-girl/idle-processing-v1/resolutions
```

The v8 suffix on resolution filenames comes from the reused GPT script, not
eight Gemini iterations. User accepted the smooth loop with minor chroma shimmer
for this version. Available as Gemini in the main selector; idle animation only.
Temporary standalone preview: `/tmp/gemini-idle-preview-v1.qml`.
