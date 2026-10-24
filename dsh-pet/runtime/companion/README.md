# Persistent GPT companion chat — Linux milestone

For Windows validation, see [the Windows smoke-test checklist](WINDOWS.md).

The fork distributes application code separately from private conversation data.
Do not add conversation databases, exported snapshots, login files or the private
standalone runtime manifest to Git. Portable handoff files belong outside the
checkout. The default export command requires explicit consent because its text
is unencrypted.

The compact Electron window displays HTML served by the existing standalone
loopback service. It is not a public website, separate model subscription, or a
replacement for the Quickshell avatar. Both windows use the same local backend.
Codex App Server owns the native conversation; an app-owned SQLite ledger retains
the user/assistant text separately. No MEMORY.md is required.

## Start

Requires Node 24, an installed/authenticated Codex CLI (`codex login`), and the
existing Electron installation. From the package directory:

```sh
npm run bundle
DSH_PET_EXTERNAL_FRONTEND=1 DSH_PET_COMPANION=1 node lib/standalone.js --port 3080
```

In another terminal:

```sh
npm run start:companion
```

Or choose **Chat with GPT girl** in the Quickshell avatar's right-click menu.
Set `DSH_PET_ELECTRON_PATH` or `DSH_PET_CODEX_PATH` if the executables are elsewhere.
The launcher reads the existing private service manifest and verifies the running
process. Starting the service without `DSH_PET_COMPANION=1` preserves its previous
behavior. This feature currently attaches to the standalone service, not the
single-process `start:app` distribution or a DeepSeek Harness plugin host.

The service connects to Codex only when a message is sent or an explicit connect
request is made. It uses the configured Codex model/account rather than the
standalone pet's separate AI-provider settings. Messages consume Codex quota.
Closing the chat window leaves the service and avatar running; reopening restores
the same history. Enter sends; Shift+Enter inserts a newline; Stop interrupts.

## Persistence and safety

- Data: `${DSH_HOME:-~/.dsh}/dsh-pet/companion/conversation.sqlite`. It contains
  private dialogue and a saved native thread ID. The UI currently shows the latest
  200 messages; older ledger entries are retained, not deleted.
- Only one service may own the ledger. A private PID/platform lock prevents a
  second service from resetting in-progress messages. Dead-process locks can be
  reclaimed; unknown-platform or ambiguous locks fail closed for manual inspection.
- Reopening resumes the saved Codex thread; a missing or invalid native thread
  produces an error, not a silent fresh conversation. Runtime/thread state remains
  in Codex's own storage. The app ledger is not automatically retrieved into model
  context and does not guarantee perfect recall after compaction.
- User messages and streamed assistant text persist as they arrive. Completed
  agent-message items replace their partial text by ID, not duplicate it. A crash
  can lose a not-yet-delivered tail; an interrupted response is labeled and never
  automatically resent. Native history reconciliation after a mid-turn crash is
  not implemented yet.
- Read-only sandbox, isolated companion working directory, disabled shell tools,
  no configured MCP servers, and denied escalation/unsupported client requests.
  This milestone does NOT offer command execution or permission-grant buttons.
  Authentication failures are surfaced without printing credentials/provider errors.
- Electron uses sandbox/context isolation, no Node integration or preload API,
  no external navigation/popups, an in-memory isolated session and denied browser
  permissions. The process capability is injected only into the companion's exact
  loopback origin/path by Electron main, never exposed to page JavaScript or argv.
  All HTML, scripts and transcript API reads require the capability header.
- SQLite schema version, restrictive directory/file permissions and a rollback
  journal are used. Do not share this active database directly between OSes or
  copy only the main file while writing. Use the logical snapshot commands below
  instead. Attachment portability and preference editing remain future work.
  Directly copying a ledger tagged with another OS still refuses native-thread
  resume; the supported import path deliberately creates fresh local context.
  Windows code paths exist but have NOT been physically validated.

## Avatar state

The service publishes `thinking` during a companion turn and clears to idle on
completion; failures publish `error`. The GPT avatar still uses its accepted idle
animation as the honest fallback. A generic task label is used, never chat text.
Existing non-companion work is not deliberately overwritten. The backend's single
external work slot has no atomic multi-writer ownership/CAS, so simultaneous harness
writers remain unsupported; this is not session multiplexing or global Codex hooks.

## Validation

```sh
node --import ./scripts/test-register.mjs --test src/companion/companion.test.ts src/standalone/server.test.ts src/standalone/request-security.test.ts src/standalone/runtime-state.test.ts
npm run typecheck
```

Live Linux checks: installed CLI handshake/authentication with MCP disabled, then
two real model turns in an isolated QA ledger. After closing/recreating the client,
the same native thread recalled an exact phrase from the first turn. This verifies
client-restart continuity, not reboot or Windows round-trip acceptance. The actual
Electron window was launched and visually inspected with an empty user conversation.

Protocol reference: https://learn.chatgpt.com/docs/app-server

## Portable conversation handoff

The database stays private and OS-local. A versioned, checksummed JSON snapshot
transfers dialogue without copying Codex's native databases, credentials, locks,
working-directory paths or native-thread metadata. This is a complete machine-made
transcript, not a manually maintained MEMORY.md. Treat exported messages as private:
the file is **unencrypted**, and a checksum detects corruption, not a forged sender.

Build once after updating this checkout (`npm run bundle`). While the service is
idle, export to a NEW filename in a trusted shared folder:

```sh
npm run companion:portable -- export --file /path/to/companion-snapshot.json --confirm-private-export
npm run companion:portable -- inspect --file /path/to/companion-snapshot.json
```

Export opens a read-only SQLite transaction and includes all ledger messages,
not only the latest 200 displayed in the UI. Pending/streaming messages cause a
refusal: wait for the response to finish. A conversation that starts after the
transaction snapshot is naturally not in that export; export again to a new file
if you keep chatting. No live writer is interrupted, and existing output files
are never deliberately overwritten. Empty or oversized histories are rejected.

On the other OS, first update the application code and build it; the Linux and
Windows repo checkouts are NOT automatically synchronized. Keep that OS's companion
service stopped while inspecting/importing:

```sh
npm run companion:portable -- inspect --file /path/to/companion-snapshot.json
npm run companion:portable -- import --file /path/to/companion-snapshot.json --confirm-import
```

The same commands work in PowerShell with a Windows path such as
`C:\\Users\\twetto\\Documents\\companion-snapshot.json`. `--data DIRECTORY` can select
a separate conversation directory for experiments; the normal service always uses
its own `${DSH_HOME:-~/.dsh}/dsh-pet/companion` directory. On Windows, start the
standalone service with `$env:DSH_PET_COMPANION='1'` and sign into Codex separately.
If necessary, set `DSH_PET_CODEX_PATH` to the native Codex executable, not a shell
wrapper. Do not copy login tokens or a platform's `node_modules` into the other OS.

An import either populates an empty ledger or adds a strict extension of the
existing message sequence. Identical imports are no-ops and preserve the native
thread. Stale, divergent, duplicate-ID, tampered, unfinished or unsupported-version
snapshots are rejected without replacing conversation history. To retain a
different branch, explicitly import into a fresh directory instead of overwriting.
The writer lock refuses import while a companion service owns the target ledger.

After an import adds messages, the UI labels the handoff and starts a fresh local
Codex thread. The first new message includes up to 20 recent historical messages
with a 24,000-character text budget; long messages can be clipped. Historical text
is framed as quoted data, not new tool instructions or actions to replay. Subsequent
turns resume that local thread normally. The complete transcript stays in SQLite,
but older facts outside that excerpt are NOT automatically recalled. This is
explicit context restoration, not exact native-session migration or perfect memory.

For the return trip, export a newer snapshot from the second OS, stop the first
OS's service, and import it there. Any independently added conversation on both
sides causes a conflict rather than a silent merge. Do not write a shared Windows
partition while Windows is hibernated/Fast Startup leaves it unsafe to mount.
Filesystem errors are failures, not reasons to force a mount or change permissions.

Validated on Linux with isolated synthetic ledgers: export/inspect/import CLI,
full-history export, safe re-import, stale/divergent rejection, active-writer
protection, corrupt input rejection, and bounded context seeding into a new thread.
Physical Windows round-trip remains an acceptance gate, not a completed claim.

# Gemini / Antigravity companion

With the updated service running under `DSH_PET_COMPANION=1`, select the Gemini
avatar and right-click **Chat with Gemini**, or run:

```sh
node scripts/start-companion.mjs agy
```

The default launcher still opens GPT. Gemini uses `agy` and your existing
Antigravity login, not Codex or a separate API key. `DSH_PET_AGY_PATH` overrides
the executable; `DSH_PET_AGY_MODEL` optionally pins a model slug. Without a pin,
Antigravity chooses its configured model. There is not yet an in-chat model
selector or automatic Argon avatar switch.

Gemini has a separate private SQLite ledger at
`~/.dsh/dsh-pet/companion-gemini/conversation.sqlite` (`DSH_HOME` overrides the
root). Its native Antigravity conversation ID is saved and resumed explicitly
across process restarts; we never use `--continue`, share GPT's transcript, or
send past review conversations. Native history is maintained by Antigravity;
the app ledger is the local display/audit copy, not a replacement for native
context. Copying this ledger alone does not move native context to another OS.
The existing default portable commands still target GPT, not Gemini.

## Chat-only restrictions

The app creates a dedicated workspace and a custom companion profile. This CLI
version still advertises built-in tools for `tools: []`, so the app also installs
a wildcard `PreToolUse` denial hook. Before starting chat it runs the no-model
`/hooks` report and requires exactly the expected enabled hook, then verifies
the stream's agent and request-review mode **before sending any prompt**.
Unexpected tool events abort the connection. There is no auto-approval flag.
Gemini runs with a persistent, child-only home under its ledger directory
(`companion-gemini/agy-home`). Your normal global plugins, MCP, hooks, rules and
settings are not inherited or modified. Both headless chat and Remote Control
use this home. Only the native `brain` and `conversations` directories are linked
back to your normal Antigravity storage (Windows junctions; Unix directory links),
so existing native thread IDs and transcript synchronization still work.
The profile carries only the three first-run completion booleans already recorded
by your normal CLI, so Remote Control does not get stuck at its welcome screen.
It does not accept new terms or permissions. Authentication uses agy's OS keyring
support; no login files are copied. If that
login is unavailable, connection fails rather than falling back to your global
configuration. The isolated home must also be free of global plugins/MCP/hooks;
unexpected customizations still block startup. This is CLI configuration
isolation and policy enforcement, not an OS-level sandbox.

Messages travel over stdin, not command-line arguments. Response failures,
timeouts and Stop preserve partial history without automatic resends. Stop
terminates the CLI connection; the next message resumes the saved conversation.
GPT and Gemini windows can coexist, with separate Electron partitions and URL
allowlists. Both require the existing local capability header.

Protocol references: [headless input/output and resume](https://antigravity.google/docs/cli/headless/),
[lifecycle hooks](https://www.agy.dev/docs/hooks?tab=cli).

# Gemini Remote Control image workaround

In the Gemini chat, send a first message if no conversation exists, then click
**Upload images in browser** while idle. The backend stops its headless writer
and hosts a temporary interactive agy session internally using optional
`node-pty`; no terminal-emulator window is required. The same native conversation
ID, workspace, model override and restricted agent are used. Existing deny-all
tool hooks are verified before handoff.

The system browser opens the validated Antigravity Remote Control URL. Sign in
with the same Google account and upload/paste images there. If automatic opening
is blocked, click **Open Remote Control**. This is remote access through Google's
service, not a local-only attachment dialog. It requires account access to Remote
Control and does not install an always-on daemon.

Click **Return to chat** when finished. The backend waits for the temporary
process/tunnel to exit before resuming the same conversation. Sending here is
blocked during handoff, including from other companion windows. Failed shutdown
keeps chat paused; retry Return rather than starting another writer. Service
shutdown also closes the managed session.

New external messages and supported images are mirrored into the local SQLite
display ledger on Return, after the remote writer exits and before headless chat
resumes. Nothing is resent to Gemini. The importer reads only this conversation's
documented native `transcript.jsonl`, filters out system/tool/reasoning fields,
and copies bounded image files from its `.user_uploaded` directory into private
`companion-gemini/images/` storage. Thumbnails survive moving the native image or
restarting the service. Gemini still rejects direct chat-window image uploads.

A pre-handoff transcript checkpoint excludes turns already displayed here.
Native step IDs and fingerprints prevent duplicates; messages, image references
and checkpoint metadata commit together. Rewound/changed history, unknown formats,
truncated/incomplete messages, missing/oversized logs and unsafe image paths abort
the import with a notice, without replacing saved messages or preventing native
chat from resuming. Graceful service shutdown also attempts to import an active
handoff after closing it. The native JSONL schema may change upstream, even though
the file location is documented.

Earlier missing browser exchanges are **not automatically backfilled**: their
position relative to existing local turns needs separate reconciliation. Existing
gap notices remain visible even when a new handoff syncs successfully. Image-bearing
portable export remains explicitly unsupported. Draft text in this window is
preserved during handoff. GPT and Claude do not use these controls.

`node-pty` is optional so ordinary chats still work if its native module is
missing. Install/build it for the OS and Node version running the service, not
Electron's ABI. Linux source builds need Python, make and a C++ compiler; Windows
uses ConPTY and may require the Windows native build tools. Missing native support
produces an actionable error without changing conversation history. Linux tested;
Windows handoff still needs validation.

With this repository's pnpm setup, run `corepack pnpm install` normally (without
`--ignore-scripts`), or `corepack pnpm rebuild node-pty` after installing build
tools. The workspace explicitly permits this package's native build scripts.

Reference: [Antigravity session-scoped Remote Control](https://antigravity.google/docs/remote-control?tab=cli).
Transcript location: [Antigravity hook common fields](https://antigravity.google/docs/hooks?tab=cli).

# Claude companion

## Image attachments (GPT and Claude)

- Drag image files from Thunar or another file manager into the chat window.
- Paste a screenshot/copied image with Ctrl+V. Text paste still works normally.
- Open **Attach an image path**, enter an absolute path, `~/Pictures/...`, or a
  local `file:` URL, then click Attach. Merely mentioning a path in chat does not
  grant file access. Remote URLs are not fetched.
- Review the thumbnails, remove unwanted attachments, and click Send with or
  without text. There is no file picker. Attaching alone does not send anything
  to the model; Send does. Image-only messages ask her to look at the images.

Limits: four images per message, 5 MiB per image, 8000px per side and 20
megapixels; PNG, JPEG, WebP and GIF. Claude uses the first frame of animations.
Actual formats are checked from image headers, not filenames or browser MIME
claims. The model can still reject damaged/unsupported image contents.

The app copies attachments into the private `companion/images/` (GPT) or
`companion-claude/images/` directory
with random IDs, private permissions and integrity hashes. SQLite stores the
message-to-image references; saved thumbnails survive restarts even if the
original file moves. Selected images are sent as native base64 image blocks (Claude)
or data-URL image inputs (Codex App Server) over CLI
stdin; general file tools remain disabled. Only explicitly attached files are
read. Path attachment refuses symlink files, devices, directories and oversized
files. Thumbnail endpoints require the same local capability as the chat.

Remove deletes an unsent upload. Sent images remain with conversation history;
there is a 256 MiB storage cap. Closing a window with an unsent draft can leave
its private uploads on disk, but never sends them automatically. Portable export
of a ledger containing images is refused until an attachment-aware format is
implemented, rather than silently omitting image history.

Vision reference: [Claude image blocks and supported formats](https://platform.claude.com/docs/en/build-with-claude/vision).
GPT reference: [Codex App Server input items](https://learn.chatgpt.com/docs/app-server).

Direct Gemini attachments are not enabled: [Antigravity's stream-JSON protocol](https://antigravity.google/docs/cli/headless/)
currently supports text blocks only and rejects other block types. The UI reports
this limitation instead of sending base64 as text or enabling general file tools.
Direct uploads need an upstream protocol update or a different backend; the Remote
Control handoff described above is the verified same-conversation workaround.

Select Claude in the avatar menu, then **Chat with Claude**, or launch:

```sh
node scripts/start-companion.mjs claude
```

Requires the updated `DSH_PET_COMPANION=1` service and a working Claude Code
subscription/API login. `DSH_PET_CLAUDE_PATH` overrides the executable;
`DSH_PET_CLAUDE_MODEL` optionally pins a model. Without a pin Claude Code uses
its configured default. No model-selection UI is provided yet.

Claude's private ledger is `~/.dsh/dsh-pet/companion-claude/conversation.sqlite`,
separate from GPT and Gemini. The app saves a native session ID and uses
`--resume` on subsequent turns, never `--continue` or any earlier review session.
Claude Code maintains its own native transcript/context; our SQLite ledger
stores the visible conversation and statuses. Copying SQLite alone does not
move native context to another OS. Portable context import is not implemented
for Claude and is explicitly refused rather than silently dropping context.

Each turn runs with `--safe-mode`, `--tools ""`, `--strict-mcp-config`, an empty
MCP configuration, disabled hooks/auto-memory, disabled slash commands, and
`dontAsk`/no permission prompts. This avoids loading personal/project
customizations while retaining the normal Claude login (unlike `--bare`, which
does not use subscription OAuth). The stream must confirm the expected session
ID, an empty tool list and no MCP servers; unexpected tool blocks stop the
connection. These are CLI restrictions, not an OS-level sandbox.

User text is sent over stdin, not command-line arguments. Only text deltas and
the final visible response are saved; thinking blocks are ignored. Stop and
failure retain partial text without retries. A fresh CLI process resumes the
same native session for each turn. Electron uses a separate partition and URL
allowlist for each companion. Existing GPT/Gemini history is never supplied to
Claude.

Reference: [Claude Code headless mode](https://code.claude.com/docs/en/headless)
and [CLI flags](https://code.claude.com/docs/en/cli-reference).

### Retrying failed Gemini browser-history sync

Windows uploads can record image paths through the companion's isolated `brain`
junction. The importer accepts that specific alias only after verifying its
actual target against the native conversation directory; arbitrary links and
cross-conversation images remain rejected.

A failed sync now retains its checkpoint. Restarting the service retries the
pending import, with native step IDs preventing duplicate messages and images.
For failures from older builds that discarded checkpoints, recovery is limited
to short, complete local chats whose full message sequence matches the beginning
of the native transcript (allowing agy's extra terminal newline on assistant
replies). Partial, imported, conflicting or display-truncated histories are left
unchanged with a warning. This does not perform general historical backfill.
