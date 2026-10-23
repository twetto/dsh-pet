# Full-resolution source control

`idle-source-v7.webp` contains all 240 source frames at 24 fps, losslessly
encoded after a fixed integer crop (728x688 at x324, y12) of the original
1280x720 MP4. No asset resizing, keying, stabilization, interpolation, or AA.
The green background deliberately remains. Original MP4 remains untouched at
`~/Pictures/GPT_avatar/gemini_generated_video_5bd7d277.mp4`.

Reproduce with:

```sh
ffmpeg -i ~/Pictures/GPT_avatar/gemini_generated_video_5bd7d277.mp4 -vf 'crop=728:688:324:12' -an -c:v libwebp_anim -lossless 1 -loop 0 idle-source-v7.webp
```

The crop corresponds to twice the processed master's fixed crop, preserving
nominal framing and rendered character size. Same AnimatedImage backend and
window as the master comparison. Display scaling still occurs; this is not a
one-source-pixel-per-screen-pixel test. Source has its original vertical motion
and 10-second endpoint jump; assess contour shimmer away from that jump.
Master has stabilization and a shorter optical-flow loop, so this comparison
isolates neither individual processing stages nor motion-identical frames.

IPC: `video matte source` / `video matte master` switches in the same window.
Visual acceptance pending; lossless encoding alone does not remove source aliasing.

## Full-resolution key-only comparison

User verdict: shimmer remains, but at this resolution it is subtle. Green source
looked okay; green may hide edge noise. Do not call keying the proven root cause.

`idle-keyed-v7.webp` applies the existing green-excess key and background-color
unmix to the decoded lossless source control. Same 728x688 pixels, 240 frames,
24 fps and original motion; no resize, stabilization, loop interpolation or AA.
Only keying and lossless encoding differ. Switch with `video matte keyed` versus
`video matte source`. Transparency can reveal edge noise hidden by green, so
this comparison does not alone prove the key algorithm creates any shimmer.

```sh
python3 scripts/key-gpt-source.py assets/gpt-girl/video-source-v7/idle-source-v7.webp assets/gpt-girl/video-source-v7/idle-keyed-v7.webp
```

## Full-resolution stabilization comparison

`idle-stabilized-v7.webp` restores vertical baseline stabilization only, using
`scripts/stabilize-gpt-source.py` on the keyed control. Same 728x688 canvas and
240 frames at 24 fps. Alpha>=128 baseline, sigma-2-frame Gaussian correction
trajectory, premultiplied bilinear vertical translation; no asset downsampling,
AA, or loop interpolation. Subpixel translation necessarily resamples pixels.
Report: `idle-stabilized-v7.json`. Visual verdict pending; retain key-only control.

```sh
python3 scripts/stabilize-gpt-source.py assets/gpt-girl/video-source-v7/idle-keyed-v7.webp assets/gpt-girl/video-source-v7/idle-stabilized-v7.webp
```

IPC `video matte stabilized` versus `video matte keyed`. Assess shimmer and foot
motion away from the original end/start jump. Restore seamless looping only
after visual acceptance of this stage.

User accepted stabilization: steady, no reported objection to subtle shimmer.

## Full-resolution loop

`idle-looped-v7.webp` restores the optical-flow loop on the accepted stabilized
control. Retained frames are unchanged; only the 12-frame bridge is synthesized
with full-resolution bidirectional DIS flow and premultiplied warp/blend.
No downsampling, AA, or lossy intermediate. Endpoint selection uses reduced
analysis thumbnails only; playback and flow stay 728x688. Original controls stay
available. Visual loop acceptance pending; inspect hair/wings and seam motion.

```sh
python3 scripts/loop-gpt-source.py assets/gpt-girl/video-source-v7/idle-stabilized-v7.webp assets/gpt-girl/video-source-v7/idle-looped-v7.webp
```

IPC `video matte looped` / `video matte stabilized`; frame range and duration
are in `idle-looped-v7.json`.
