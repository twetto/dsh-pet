# Electron 模型角色（Windows 開發測試）

直接使用 repo 已接受的透明 animated WebP；不重新產生或轉碼素材。
三個角色目前都只有待機動畫，不會把待機動畫說成工作、拖曳或點擊動畫。
這是獨立的桌面呈現入口；Linux Quickshell 與原有藍鯨 helper 保留原本行為。
目前以開發 checkout 執行，尚未加入 release-app 安裝包。

## Windows 一鍵啟動

依賴與 Electron 已安裝的這份 checkout，可直接雙擊 repo 根目錄的
`Start-Pets.cmd`。它會在背景啟動或沿用 companion 服務，並顯示三個角色；不需要
保持 PowerShell 開啟。重複執行會重用既有角色視窗。

預設沿用 `%LOCALAPPDATA%\dsh-pet-windows-smoke` 的既有聊天資料。
若環境已指定 `DSH_HOME`，則使用該目錄。啟動失敗時命令視窗會保留錯誤訊息；
背景日誌在 `$DSH_HOME/dsh-pet/launcher-logs/`。

雙擊 `Stop-Pets.cmd` 會要求角色及聊天服務正常關閉，不會刪除聊天歷史。
已開啟的聊天室視窗可自行關閉。要只關閉某個角色，仍可用它的右鍵選單。

命令列可選擇 `Start-Pets.cmd gpt`、`Start-Pets.cmd claude` 或
`Start-Pets.cmd gemini`；不帶參數等同三個全開。

## 啟動

在 `dsh-pet/` 套件目錄的 PowerShell：

```powershell
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA "dsh-pet-windows-smoke"
# 已經安裝過 Electron 就不用再執行這一步
npm run ensure:electron
npm run start:avatar -- gpt
```

角色動畫可獨立執行。要開啟聊天室，使用相同 `DSH_HOME` 的既有 companion
服務即可，不需要重啟或關閉服務。

`gpt` 可換成 `claude` 或 `gemini`。三個同時啟動：

```powershell
npm run start:avatar -- all
```

每個啟動目標有自己的視窗、單例鎖及系統匣選單；重跑相同目標會重用該視窗。
三個角色初始會在主螢幕下緣分開排列，可各自拖曳、調整大小、開啟聊天室或關閉。
右鍵切換形象只影響目前視窗，該視窗仍屬於最初的啟動目標。
也可使用 `DSH_PET_ELECTRON_PATH` 指定 Windows Electron 執行檔。

## 操作

- 角色上按住左鍵拖曳；透明邊緣穿透到下方視窗。
- 右鍵選單切換 GPT 龍娘／Gemini 貓娘／Claude，調整大小或重設位置。
- 雙擊角色，或右鍵「開啟聊天室」，開啟目前角色對應的既有聊天功能。
- 系統匣也有角色切換、大小、位置重設及關閉選單。
- 「關閉角色」只關閉角色視窗；聊天服務繼續執行。

預設動畫畫布高度 220 DIP，四周 12 DIP 透明空間；原始 accepted clip 為
344px 高。Windows 縮放比例可能讓原生視窗尺寸有約 1 DIP 的捨入差異。
角色被限制在目前螢幕的可用區域；移除螢幕時會回主螢幕。

動畫僅讀取三個固定本機素材。視窗使用 sandbox、context isolation、關閉 Node
integration，拒絕外部網路及導覽。聊天室 capability 留在主程序與聊天子程序，
不傳給角色 renderer。角色前端不讀聊天內容。

## 驗證

```powershell
$env:DSH_PET_ELECTRON_PATH = Join-Path $env:LOCALAPPDATA "dsh-pet-windows-smoke/electron/electron.exe"
node --test scripts/tests/windows-avatar.test.mjs
```

實際 Windows Electron 測試涵蓋三個動畫解碼／連續畫面變化、截圖 alpha、切換、
DPI 尺寸與長時間拖曳不累積縮放、sandbox、角色本體／透明區域的原生穿透開關、
對外 fetch 阻擋，以及雙擊／右鍵啟動後聊天室的實際 Windows 視窗可見性。
測試使用獨立暫存設定，不讀取私人對話。截圖在 ignored 的 `lib/avatar-qa/`。
拖曳手感、視覺邊緣及跨螢幕／不同縮放的實際操作仍需要使用者桌面驗收。
