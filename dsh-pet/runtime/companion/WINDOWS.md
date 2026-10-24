# Windows companion smoke test

This is a test checklist, not a claim of Windows compatibility. Linux chat,
attachments and Gemini Remote Control/history sync are verified. Windows native
CLI discovery, filesystem permissions, ConPTY and transcript paths need testing.
Quickshell and the `dragon` launcher are Linux-only; test chat windows first.

## Prepare in Windows PowerShell

Use the Windows checkout and Windows Node 24. Do not run these commands in WSL
or reuse Linux `node_modules`, built native addons, authentication or databases.
Install/authenticate the Windows Codex, Claude Code and Antigravity CLIs separately.

```powershell
Set-Location "$HOME\Documents\devs\dsh-pet\dsh-pet"
node --version
Get-Command codex, claude, agy
corepack pnpm install
npm run build
```

If the checkout is elsewhere, adjust the path. If a pre-existing dependency tree
comes from Linux, move it aside before installing rather than reusing it.
The optional `node-pty` package must build for the service's Node version, not
Electron's ABI. If necessary install Windows native C++ build prerequisites and
run `corepack pnpm rebuild node-pty`. Missing PTY support should only prevent
Remote Control, not text chat.

Use a separate test data directory. CLI native conversations still use each
Windows CLI's normal storage; this variable isolates the app's ledgers/Electron.

```powershell
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA "dsh-pet-windows-smoke"
npm run ensure:electron
$env:DSH_PET_EXTERNAL_FRONTEND = "1"
$env:DSH_PET_COMPANION = "1"
node lib/standalone.js --port 3080
```

Leave that terminal running. In another PowerShell window:

```powershell
Set-Location "$HOME\Documents\devs\dsh-pet\dsh-pet"
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA "dsh-pet-windows-smoke"
node scripts/start-companion.mjs codex
```

Use `claude` or `agy` instead of `codex` for the other chats. If Electron is
already installed elsewhere, set `DSH_PET_ELECTRON_PATH` to its Windows executable
instead of downloading it into this test directory.

CLI launch failures are an expected compatibility checkpoint. Inspect
`Get-Command <name> -All` and check whether the launcher resolves an executable
or a shell wrapper. The optional `DSH_PET_CODEX_PATH`, `DSH_PET_CLAUDE_PATH` and
`DSH_PET_AGY_PATH` variables can select native executables. Do not work around a
wrapper failure by enabling an unrestricted shell or removing tool restrictions.

## Checklist

- Send one message per provider. Verify replies, Stop and provider isolation.
- Close/reopen each window. Stop the idle service with Ctrl+C, restart it using
  the same test data directory, then reopen windows and verify local history and
  native conversation continuity. Reopen old windows after a service restart;
  the local capability token rotates.
- GPT/Claude: drag an image from Explorer, paste a screenshot, attach an absolute
  Windows image path, remove a draft and send with/without text. Verify thumbnails
  after restart and after moving the original file.
- Gemini: send a first message, click **Upload images in browser**, upload an image
  through Remote Control, then **Return to chat**. Verify tunnel closure, resumed
  chat, new messages/images, no duplicates and thumbnails after restart. Repeat
  with identical message text to check native-step deduplication.
- Missing/unsupported native transcript data must show an incomplete-history
  warning while native chat remains usable. Earlier missing exchanges are not
  automatically backfilled. Direct Gemini attachments remain unsupported.
- Avatar rendering/selection in the Windows Electron desktop helper is a separate
  follow-up; Linux Quickshell behavior does not establish Windows avatar support.

Use fresh Windows test conversations first. Moving Linux SQLite files does not
move native model context; foreign-OS resume/import is intentionally restricted.
Do not overwrite either OS's real conversation data. Image-bearing portable
exports and Gemini/Claude portable imports remain unsupported.

## Reporting a failure

Record Windows version, `node --version`, CLI versions, failing checklist step and
the sanitized error. Do not post capability URLs/tokens, auth files, conversation
databases, native transcripts or personal screenshots. Nothing in the private
test directory belongs in Git.
