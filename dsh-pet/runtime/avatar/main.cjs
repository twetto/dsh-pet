const { app, BrowserWindow, Menu, Tray, ipcMain, screen, session, dialog } = require('electron');
const { readFileSync, mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { avatars, avatarId, clipPath, windowSize, confine } = require('./catalog.cjs');
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
app.setName('dsh-pet 角色');
const argument = (argv) => argv.find((arg) => arg.startsWith('--avatar='))?.slice(9);
let current;
try {
  current = avatarId(argument(process.argv) || process.env.DSH_PET_AVATAR || 'gpt-girl');
} catch (error) {
  console.error(error.message);
  app.exit(1);
}
// Each launch target owns an independent window/lock, even when its menu switches appearance.
const slot = current;
const slotIndex = Object.keys(avatars).indexOf(slot);
const profile = join(home, 'dsh-pet', 'avatar-electron', slot);
mkdirSync(profile, { recursive: true, mode: 0o700 });
app.setPath('userData', profile);
let window,
  tray,
  ticker,
  drag,
  pointer,
  menuOpen = false;
let height = 220;
let ignored;
const target = pathToFileURL(join(__dirname, 'index.html')).href;
function configuration() {
  return { id: current, label: avatars[current].label, url: pathToFileURL(clipPath(current)).href };
}
function setIgnored(value) {
  if (!window || window.isDestroyed() || value === ignored) return;
  ignored = value;
  window.setIgnoreMouseEvents(value, { forward: true });
}
function trusted(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === target
  );
}
function place(reset = false) {
  const size = windowSize(current, height);
  const bounds = window.getBounds();
  const area = reset ? screen.getPrimaryDisplay().workArea : screen.getDisplayMatching(bounds).workArea;
  window.setBounds(
    confine(
      {
        ...size,
        x: reset
          ? area.x + area.width - size.width - 28 - slotIndex * Math.min(280, Math.floor(area.width / 3))
          : bounds.x,
        y: reset ? area.y + area.height - size.height - 12 : bounds.y + bounds.height - size.height,
      },
      area,
    ),
  );
}
function select(value) {
  current = avatarId(value);
  if (!existsSync(clipPath(current))) throw new Error('缺少角色動畫素材，請確認 repo 已完整下載。');
  drag = undefined;
  pointer = undefined;
  place();
  window.setTitle('dsh-pet · ' + avatars[current].label + ' · 待機動畫');
  window.webContents.send('avatar:changed', configuration());
  refreshTray();
}
async function openChat() {
  const provider = avatars[current].provider;
  try {
    const runtime = JSON.parse(readFileSync(join(home, 'dsh-pet', 'standalone-runtime.json'), 'utf8'));
    if (
      !runtime.companion ||
      (provider === 'agy' && !runtime.geminiCompanion) ||
      (provider === 'claude' && !runtime.claudeCompanion)
    )
      throw new Error();
    if (
      !Number.isInteger(runtime.port) ||
      runtime.port < 1 ||
      runtime.port > 65535 ||
      !/^[A-Za-z0-9_-]{43}$/.test(runtime.token || '')
    )
      throw new Error();
    const response = await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal: AbortSignal.timeout(3000) });
    const status = await response.json();
    if (!response.ok || status.pid !== runtime.pid || status.name !== 'dsh-pet-standalone') throw new Error();
    const env = {
      ...process.env,
      DSH_PET_CHAT_PORT: String(runtime.port),
      DSH_PET_CHAT_TOKEN: runtime.token,
      DSH_PET_CHAT_PROVIDER: provider,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, [join(__dirname, '../companion')], {
      env,
      stdio: 'ignore',
      // This is the GUI itself, not a console helper. Hiding its startup window
      // makes an otherwise healthy companion invisible on Windows.
      windowsHide: false,
      detached: true,
    });
    child.on('error', () => dialog.showErrorBox('聊天室無法啟動', '請確認 Electron 與本機 companion 服務仍在執行。'));
    child.unref();
  } catch {
    dialog.showErrorBox('聊天室尚未連線', '請先用相同 DSH_HOME 啟動 companion 服務。角色動畫可以獨立使用。');
  }
}
function menu() {
  return Menu.buildFromTemplate([
    { label: avatars[current].label + ' · 待機動畫', enabled: false },
    { label: '開啟聊天室', click: () => void openChat() },
    { type: 'separator' },
    ...Object.entries(avatars).map(([id, avatar]) => ({
      label: avatar.label,
      type: 'radio',
      checked: current === id,
      click: () => select(id),
    })),
    { type: 'separator' },
    {
      label: '角色大小',
      submenu: [180, 220, 280, 344].map((value) => ({
        label: value + ' px',
        type: 'radio',
        checked: height === value,
        click: () => {
          height = value;
          place();
          refreshTray();
        },
      })),
    },
    { label: '移回主螢幕右下角', click: () => place(true) },
    { label: '關閉角色', click: () => app.quit() },
  ]);
}
function refreshTray() {
  if (tray) {
    tray.setToolTip('dsh-pet · ' + avatars[current].label);
    tray.setContextMenu(menu());
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else if (process.argv.includes('--quit-avatar')) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit-avatar')) {
      app.quit();
      return;
    }
    try {
      if (argument(argv)) select(argument(argv));
      window?.showInactive();
    } catch {}
  });
  app
    .whenReady()
    .then(async () => {
      const partition = session.fromPartition('dsh-pet-avatar');
      const allowed = new Set(
        ['index.html', 'style.css', 'renderer.js'].map((name) => pathToFileURL(join(__dirname, name)).href),
      );
      for (const id of Object.keys(avatars)) allowed.add(pathToFileURL(clipPath(id)).href);
      partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed.has(details.url) }));
      partition.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      partition.setPermissionCheckHandler(() => false);
      window = new BrowserWindow({
        ...windowSize(current, height),
        title: 'dsh-pet · ' + avatars[current].label + ' · 待機動畫',
        transparent: true,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          session: partition,
          backgroundThrottling: false,
        },
      });
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setMenu(null);
      place(true);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      ipcMain.handle('avatar:configuration', (event) => {
        if (!trusted(event)) throw new Error('Invalid avatar frame');
        return configuration();
      });
      ipcMain.on('avatar:hit', (event, value) => {
        if (trusted(event) && !drag && !menuOpen) setIgnored(value !== true);
      });
      ipcMain.on('avatar:drag', (event, action) => {
        if (!trusted(event)) return;
        if (action === 'end') {
          drag = undefined;
          pointer = undefined;
          return;
        }
        if (action !== 'begin') return;
        const point = screen.getCursorScreenPoint(),
          bounds = window.getBounds();
        drag = {
          x: point.x - bounds.x,
          y: point.y - bounds.y,
          size: windowSize(current, height),
          expires: Date.now() + 30000,
        };
        setIgnored(false);
      });
      ipcMain.on('avatar:menu', (event) => {
        if (!trusted(event)) return;
        drag = undefined;
        menuOpen = true;
        setIgnored(false);
        menu().popup({
          window,
          callback: () => {
            menuOpen = false;
            pointer = undefined;
          },
        });
      });
      ipcMain.on('avatar:chat', (event) => {
        if (trusted(event)) void openChat();
      });
      const icon = join(__dirname, '../../assets/logo.png');
      tray = new Tray(icon);
      refreshTray();
      tray.on('double-click', () => void openChat());
      screen.on('display-removed', () => place(true));
      screen.on('display-metrics-changed', () => place());
      ticker = setInterval(() => {
        if (!window || window.isDestroyed()) return;
        const point = screen.getCursorScreenPoint(),
          bounds = window.getBounds();
        if (drag) {
          if (Date.now() > drag.expires) {
            drag = undefined;
            pointer = undefined;
            return;
          }
          window.setBounds(
            confine(
              // Always use the chosen DIP size, not GetBounds' rounded size.
              // Reapplying rounded widths on fractional DPI accumulates growth.
              { ...drag.size, x: point.x - drag.x, y: point.y - drag.y },
              screen.getDisplayNearestPoint(point).workArea,
            ),
          );
        } else if (!menuOpen && (!pointer || point.x !== pointer.x || point.y !== pointer.y)) {
          pointer = point;
          if (
            point.x < bounds.x ||
            point.y < bounds.y ||
            point.x >= bounds.x + bounds.width ||
            point.y >= bounds.y + bounds.height
          )
            setIgnored(true);
          else window.webContents.send('avatar:pointer', { x: point.x - bounds.x, y: point.y - bounds.y });
        }
      }, 20);
      window.on('closed', () => {
        clearInterval(ticker);
        app.quit();
      });
      await window.loadFile(join(__dirname, 'index.html'));
      window.showInactive();
    })
    .catch(() => {
      console.error('角色視窗啟動失敗，請確認 Electron 與素材路徑。');
      app.quit();
    });
  app.on('before-quit', () => {
    clearInterval(ticker);
    tray?.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
