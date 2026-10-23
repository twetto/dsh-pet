# Native Wayland interaction spike

From the `dsh-pet/` package directory:

```sh
node scripts/prepare-quickshell.mjs
QT_QPA_PLATFORM=wayland qs -n -p runtime/quickshell/shell.qml
```

Requires Quickshell 0.3.x, Qt's animated WebP image plugin, and FFmpeg with
`libvpx-vp9` and `libwebp_anim`, plus Node.js 24 (the bridge imports shared TypeScript).
The preparation script generates thirteen clips
(idle, dangling, five click responses, and the six work states) in
`${XDG_CACHE_HOME:-$HOME/.cache}/dsh-pet/quickshell/`; existing clips are reused.
Original WebM source files are unchanged. Remove a generated cache file explicitly
if you need to regenerate it.

## Interactions

### Avatar selection

The native right-click menu offers **DeepSeek** and **GPT girl**. DeepSeek retains
its 106 actions, five random click responses and work/drag animations. GPT uses
the accepted 344px-high lossless idle loop, downsampled once AFTER full-resolution
keying, stabilization and optical-flow looping. Its 688px keeper is preserved.
Selecting GPT requests a 256x244 window matching the video trial; DeepSeek uses
400x225. Native left drag and right-click menu remain available.

GPT receives the same service states/task updates but has no custom action clips
yet. Work states, clicks and dragging keep the idle animation; no DeepSeek clip is
substituted. A small non-idle label explicitly says `idle animation`; offline is
labeled too. GPT has no selectable action catalog. State/task and `idleFallback`
are available through IPC. The deferred niri click-through limitation is unchanged.

Selection lasts for the current session. For a fresh GPT launch:

```sh
DSH_PET_AVATAR=gpt-girl QT_QPA_PLATFORM=wayland qs -n -p runtime/quickshell/shell.qml
```

Without that option startup defaults to DeepSeek. IPC selection:

```sh
qs ipc -p runtime/quickshell/shell.qml call pet avatar gpt-girl
qs ipc -p runtime/quickshell/shell.qml call pet avatar deepseek
```

This connects GPT to the existing service bridge, not automatically to
Codex/Claude/agy session events. External harness hook adapters remain separate
work: they must publish authenticated events to the existing work-status API.
The frontend remains read-only and never loads the service capability token.

Live checks verified all six authenticated service states reach GPT with idle
fallback, switching back restores DeepSeek's state and 106 actions, and clearing
the test state returns connected idle. Physical menu/drag acceptance is separate.

### Bundled DeepSeek interactions

- Actions submenu: all 106 bundled WebM animations, searchable by their original
  names and scrollable with the mouse wheel/scrollbar. Click Actions to focus the
  search field; Down and Enter can select a filtered result. Escape dismisses.
  Selecting an action prepares its 400px transparent WebP on first use, then plays
  it once and resumes the latest work state. Cached selections start promptly.
  The preparation message appears below the avatar; selections are disabled while
  conversion runs. Resume work state cancels a pending preview (conversion may
  finish and cache its result). Movement clips preview the animation only: they do
  not automatically move the window or implement Electron physics.

The menu catalog is built from the bundled `assets/webm/` files, not a hardcoded
subset. This action catalog covers DeepSeek only; GPT currently has its idle loop.
No full-library conversion is performed at startup. Cache growth is on demand;
generated files use atomic replacement so a failed conversion is not reused.
Specific clips can also be prewarmed with
`node scripts/prepare-quickshell.mjs '吃白饭' '三球抛接'`.
Test IPC uses `qs ipc -p runtime/quickshell/shell.qml call pet action '吃白饭'`.
The existing `preview` IPC assumes a clip is already cached; `action` prepares it.

- Left-click: randomly play one of the five click responses, avoiding the previous
  response, then return to the latest work state. All five are prepared by the
  default setup command; missing cache entries are prepared on demand.
- Plain left-drag beyond five logical pixels: request compositor system movement
  and switch to the dangling animation. No Mod key or global cursor polling.
- Right-click: open a separate native popup. Hover Actions for its second column.
  There is no pointer-leave dismissal timer. Select an item, click outside, or use
  Escape to close. Preview dangling is a manual animation preview, not a drag.
- Transparent margins have no input region. The compact 400x225 window has no
  extra space for menus; its popup is a separate surface.
- Stop with Ctrl+C or the compositor's window-close command. No click-to-pause.

The body mask is an approximate rectangle, not per-pixel alpha hit testing.

## Drag-completion experiment

Qt/niri takes the pointer when `startSystemMove()` succeeds. The observed sequence
is press, accepted move, cancellation, pointer exit, pointer re-entry with no
buttons. The spike ends dangling on that re-entry; a delivered release also ends
it. Cancellation alone does not end it, since it occurs when system movement
starts. There are no coordinate polls or movement-inactivity timers.

Repeated real pointer moves produced this completion sequence on the local niri
session. Stationary holds, cancellation, focus changes, screen-edge cases, and
cross-monitor drops remain separate acceptance checks. If re-entry never arrives,
the probe may remain in the dangling state; do not describe this as fully solved
until the physical cases pass.

State can be inspected without interacting with the window:

```sh
qs ipc -p runtime/quickshell/shell.qml call pet status
```

For controlled animation-switch measurements when not physically dragging:

```sh
qs ipc -p runtime/quickshell/shell.qml call pet preview click
qs ipc -p runtime/quickshell/shell.qml call pet preview idle
```

Logs show pointer transitions, accepted moves, completions, menu visibility, and
animation selections. IPC remains a local test interface.

## Existing service connection

Build and start the existing standalone service in one terminal:

```sh
pnpm run bundle
DSH_PET_EXTERNAL_FRONTEND=1 node lib/standalone.js --port 3080
```

Then prepare the clips and launch Quickshell using the commands above. The opt-in
environment variable suppresses Electron startup/downloads; without it the normal
Windows/Electron path is unchanged. No niri changes are required.

`service.mjs` polls the existing `/dsh-pet-7340/state` once a second, reusing the
shared work-status parser. It only reads state; it does not read tokens, write
work events, configure AI, or start the backend. Initial empty work state means
connected idle. Failed requests clear to disconnected idle and retry. Identical
snapshots are not resent. IPC status includes `connected`, `workState`, and `task`.
Task text is diagnostic only; bubbles are not implemented.

Set `DSH_PET_SERVICE_URL=http://127.0.0.1:3081` when launching Quickshell if the
service uses another port (including its automatic occupied-port fallback).
Only local HTTP URLs are accepted and redirects are rejected. The bridge exits
with its Quickshell Process owner; the independently started service stays running.

All six existing service states map to their corresponding animations. Actual
dragging overrides work updates; ending the move resumes the latest state. A click
reaction plays once before resuming the latest state. Manual action selections
also play once, then resume the latest service state.
Terminal success/error states remain visible until the service changes or clears
them: the fixed external API slot currently has no expiry or multi-writer arbitration.
The service also deliberately delays rapid working-to-result transitions by up
to five seconds; the frontend does not bypass that debounce.

Focused tests:

```sh
node --test scripts/tests/quickshell-service.test.mjs
```

Live authenticated API checks confirmed thinking, working, result, waiting,
success, error, clear-to-idle, and click-reaction recovery to working. This verifies
state delivery/selection, not fresh physical drag/menu acceptance or alpha quality
for every frame. Harness adapters are not connected yet.

A five-second sample after exercising clips measured the existing Quickshell
process at 10.2% of one CPU core / 409.8 MiB RSS and its new Node bridge at 0.4% /
99.6 MiB RSS. This is a short diagnostic sample, not a steady-state benchmark or
an efficiency pass. Resource optimization remains pending.

## Current validation (2026-10-23)

User physical testing confirms the interactions work except horizontal
click-through: nearby transparent margins block new terminal clicks, while
farther clicks pass through. A selection started in the terminal can extend
behind the pet because the terminal retains its pointer grab.

The real pet's Wayland protocol trace sends:

```text
wl_region.add(125, 28, 150, 178)
wl_surface.set_input_region(region)
xdg_surface.set_window_geometry(0, 0, 400, 225)
```

The installed niri commit `8ed0da4` falls back from the client's input region to
activating the entire tile rectangle. This matches upstream
[issue #4380](https://github.com/niri-wm/niri/issues/4380) and its
[proposed fix #4381](https://github.com/niri-wm/niri/pull/4381). Consequently,
correct client input-region messages do not establish transparent-margin
click-through on this compositor version. Quickshell does not bypass that
remaining niri behavior. Do not declare the full acceptance gate passed.

User chose to defer the upstream compositor fix and accept this limitation for
now. Do not change the running compositor or silently
replace native system drag with a layer-shell interaction.

- Electron 43.3.0 native-Wayland control requested a shape containing one green
  square. The compositor capture still showed the red square outside that shape.
  The attempted native shape was not honored in that control; no Electron-only
  solution is established. X11 helper development remains parked.
- QML loads on Quickshell 0.3.2; `qmllint` passes. Three transparent clips load.
- Real drag logs show niri accepting moves and returning to idle on pointer re-entry.
- One five-second sample during the interaction session measured roughly 11% of
  one CPU core and 385 MiB RSS. This is provisional, not an isolated idle benchmark.
  Cache files total about 19 MiB. Resource efficiency remains an adoption gate.
- User reports other tested interactions working; full transparent-margin
  click-through remains blocked as described above. Cross-monitor and extended
  cancellation/focus cases remain unverified. Do not substitute renderer-injected
  tests for physical checks.

The service bridge is connected; automatic external harness hooks, chat and
physics integration are not implemented here. Current
renderer-side Electron behavior is not automatically shared with QML. The old
`layer.qml` is retained only as a rendering comparison and is not the chosen
drag-capable frontend.
