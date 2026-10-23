# GPT girl: approved concept and idle pilot

## Fork distribution

The supported frontend uses `video-resolutions-v8/idle-loop-344-v8.webp` (the
accepted playback clip). It is included in Git along with the concept PNGs and
pipeline scripts. The full-resolution keeper and rejected video intermediates
remain local and ignored, not deleted. Historical comparison previews need those
locally generated assets; they are not required to run the main pet or chat.
The original source MP4 and supplied reference images are not distributed.

Unofficial personal mascot based on the user's supplied GPT dragon-girl references.
Not an official OpenAI avatar or product announcement. Do not infer redistribution
rights for the supplied fan-art references. Their originals remain under
`~/Pictures/GPT_avatar/` and were not copied into the repository.

- `concept-v1.png`: user-approved intermediate-detail design, copied without
  alteration from the built-in image-generation output.
- `idle-blink-v1.png`: generated closed-eye variant, same 1312x1199 RGBA canvas.
- `idle-half-blink-v1.png`: generated halfway-closed eyes on the same canvas.
- `idle-look-left-v1.png`, `idle-look-right-v1.png`: generated yaw head poses.
- `prompts.md`: generation/edit prompts and reference roles.

The approved version sits between the first ornate and second minimal concepts.
Retain white/lavender hair, eyes, horns, pointed ears, knot ornament, compact wings,
curled tail, rounded chibi proportions and restrained costume detail.

## Separate desktop preview

Current mode: blink and breath ONLY, reverted at the user's request after the
yaw crossfade experiment. Three active textures; the two yaw PNGs are archived
references and no longer loaded. Look timers, gaze warping and diagnostic look IPC
are removed. Vertical-only threefold breathing and soft 220px textures are retained.

### Archived look-around experiment

Idle look-around: after a random 9–16 second rest, glance to one side, hold,
look across to the other, then ease back to center (4.34 seconds total). The first
direction is randomized. The initial shader-only rolling/tilting gesture was
rejected, then replaced with generated left/right yaw head poses. A feathered head
mask and approximate face-alignment warp blend them with the approved front pose;
the lower body stays unchanged. This is NOT a 3D projection rig. Frontal blink
overlays fade out during turns because turned-eye blink assets do not exist.
Each side is held for 1.4/1.6 seconds. The user still sees discrete/fading transitions
and has NOT accepted this as smooth animation. Do not treat pose crossfade as a
substitute for motion frames. The old `pilot lookAround` IPC has been removed.

### Launch current preview

From the package directory:

```sh
QT_QPA_PLATFORM=wayland qs -n -p runtime/quickshell/gpt-girl/shell.qml
qs ipc -p runtime/quickshell/gpt-girl/shell.qml call pilot status
```

This creates a separate floating window and does not replace DeepSeek, subscribe
to the service, or alter the action catalog. Left-drag requests native compositor
movement. Close through niri or stop its launch process; right-click does not exit.
The existing pet-title niri rule applies. Known niri transparent-margin activation
still applies to this normal floating window.

This is a procedural QML pilot, NOT a generated video or articulated character rig.
The approved open-eye image supplies the body and silhouette on every frame.
Feathered eye masks blend open → half-closed → closed → half-open → open; other
pixels from the generated blink variants are never displayed. Closing takes 90ms,
the hold 25ms, and reopening 125ms. Pauses vary from 2.8 to 6 seconds independently
of breathing. This is pose blending, not fully drawn intermediate eyelid frames.

Breathing uses a smooth 4.2-second cycle: 38% inhale, 62% exhale. The shader adds
three times the original breathing amplitude after the user found the first
version imperceptible at desktop size (1.05% canvas-height upper lift at peak
inhale, easing back on exhale). Torso widening was subsequently removed at the
user's request: the torso now rises/falls without inflation. Side follow
is amplified by the square root of that strength rather than tripled.
The shader adds
small shoulder/head lift and slight delayed lateral
motion in the hair/wing/tail area. It does not scale the entire character; the
bottom 3% of the canvas is stationary. This is a continuous image warp, not separate
anatomically rigged parts. The visual foot baseline stays 12 logical pixels from
the window bottom, including after resizing.

Runtime image textures are decoded to 220px high instead of the previous 440px,
with smooth filtering for a softer match to DeepSeek. Full-resolution source PNGs
remain unchanged. All three active textures stay loaded; if blink textures are unavailable,
the shader uses the open eyes. The images have some registration/color differences
inside the eye patches, so assess remaining ghosting at transitions.
Alpha edge halos, exact perceived scale against DeepSeek, and natural motion need
user visual acceptance. No animation-library expansion is approved by this pilot.

The Qt 6 shader source and compiled package live beside the QML. After editing
`idle.frag`, rebuild with the installed Qt Shader Tools (Quickshell must support
the same shader-package version):

```sh
/usr/lib/qt6/bin/qsb --glsl '100 es,120,150' --hlsl 50 --msl 12 \
  -o runtime/quickshell/gpt-girl/idle-blink-breath-v4.frag.qsb runtime/quickshell/gpt-girl/idle.frag
```

Validation: five PNGs have identical RGBA canvases;
the test is `node --test scripts/tests/gpt-idle.test.mjs`. Live IPC should show both
poses ready, transitional `blinkProgress` values, changing breath, increasing blink
count, and `footOffset: 12`. Unit tests cover continuous breathing and blink-delay
bounds; live checks verify the transitions and reduced texture resolution. Desktop
capture confirms the shader renders with transparency; visual acceptance is pending.
No API key or external video service was used. No finished WebM/WebP loop is
claimed. A future proper video workflow must preserve identity, feet, framing,
transparency, and first/last-frame continuity before replacing this pilot.
