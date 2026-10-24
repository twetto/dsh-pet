@echo off
setlocal
chcp 65001 >nul
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Windows Node.js 24 or newer is required.
  pause
  exit /b 1
)
node "%~dp0dsh-pet\scripts\start-windows.mjs" %*
if errorlevel 1 (
  echo.
  echo Could not complete the request. See the message above.
  pause
  exit /b 1
)
