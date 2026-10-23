# Persistent GPT companion chat — Linux milestone

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
