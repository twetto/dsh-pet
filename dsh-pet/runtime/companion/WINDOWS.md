# Windows companion and avatar development checks

Validated in this Windows checkout with Node 24.1.0: Codex/Claude/Gemini chat,
GPT/Claude image attachments, Gemini browser upload/recognition and return/history
sync, plus the three animated Electron avatars and one-click launch/stop scripts.
The user verified the chat and desktop interactions; automated checks cover
native window visibility, fractional-DPI dragging, transparency and process reuse.
This is development-checkout validation, not an installer compatibility claim.
Cross-monitor/mixed-DPI and long-running use still need broader manual coverage.
The new shared companion changes have not yet been regression-tested on Linux.
Quickshell and the `dragon` launcher remain Linux-only.

## Prepare in Windows PowerShell

Use the Windows checkout and Windows Node 24. Do not run these commands in WSL
or reuse Linux `node_modules`, built native addons, authentication or databases.
Install/authenticate the Windows Codex, Claude Code and Antigravity CLIs separately.

```powershell
Set-Location "$HOME\Documents\devs\dsh-pet\dsh-pet"
node --version
Get-Command codex, claude, agy
corepack pnpm@11.28.8 install --frozen-lockfile
npm run build
```

Use the explicit pnpm version above. On Windows Node 24.1.0 with Corepack 0.32.0,
unversioned `corepack pnpm` can select pnpm 12.15.0 and fail with
`MODULE_NOT_FOUND` for `bin/pnpm.cjs` before dependency installation starts.
The workspace configuration targets pnpm 11; the explicit version avoids changing
your global package-manager default.

If the checkout is elsewhere, adjust the path. If a pre-existing dependency tree
comes from Linux, move it aside before installing rather than reusing it.
The optional `node-pty` package must build for the service's Node version, not
Electron's ABI. If necessary install Windows native C++ build prerequisites and
run `corepack pnpm@11.28.8 rebuild node-pty`. Missing PTY support should only prevent
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

## Gemini configuration isolation

Gemini uses a child-only home at
`$DSH_HOME/dsh-pet/companion-gemini/agy-home`; normal global plugins such as
`science` can stay installed. Chat and Remote Control share this isolated
configuration. Native conversation databases and brain transcripts remain in
your Windows Antigravity storage through directory junctions. Login is resolved
by agy through Windows Credential Manager; the app does not copy auth files.
Do not put plugins, hooks or MCP configuration into the app-owned isolated home.
After updating the code, rebuild and restart the standalone service, then reopen
the Gemini window.

Browser upload resolves `agy` to the full native `agy.exe` path before starting
ConPTY. If it is unavailable, the error names the executable and points to
`DSH_PET_AGY_PATH`. The isolated profile also reuses only the three completed
onboarding flags from your normal CLI; it does not accept terms or copy login,
plugin or permission configuration. Complete normal `agy` first-run setup first
if browser upload reports that setup is required.

If returning from browser upload previously reported a history-sync warning,
restart the updated standalone service and reopen Gemini. It retries a retained
checkpoint, or verifies the complete local prefix before recovering an older
failed handoff. Do not delete the ledger or re-upload the same image to repair
that warning. Native context and existing messages are preserved.

## 模型角色動畫

聊天測試完成後，保留目前服務，另開 PowerShell：

```powershell
Set-Location "$HOME\Documents\devs\dsh-pet\dsh-pet"
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA "dsh-pet-windows-smoke"
npm run start:avatar -- gpt
```

左鍵拖曳、右鍵切換角色／大小、雙擊開啟對應聊天室。可換成 `claude` 或
`gemini`，或從系統匣切換。目前三個角色只有待機動畫。
操作與驗證範圍見 [Electron 角色說明](../avatar/README.md)。

三個角色同時啟動可用 `npm run start:avatar -- all`；每個角色獨立移動與關閉。
若所有程式都已關閉，先依上方步驟啟動 standalone companion 服務，保持該終端
執行，再於另一個 PowerShell 設定相同 `DSH_HOME` 並執行角色命令。

## 日常一鍵啟動

本機依賴已準備好後，雙擊 repo 根目錄的 `Start-Pets.cmd` 即可啟動服務和三個
角色，不必再輸入上面的 PowerShell 指令。雙擊 `Stop-Pets.cmd` 可正常關閉角色
與背景服務；聊天歷史保留。預設沿用 Windows smoke-test 資料目錄。
