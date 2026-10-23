const { app, BrowserWindow, session } = require('electron');

const port = Number(process.env.DSH_PET_CHAT_PORT);
const token = process.env.DSH_PET_CHAT_TOKEN;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) {
  process.stderr.write('Start this window with node scripts/start-companion.mjs\n');
  app.exit(1);
} else {
  const origin = `http://127.0.0.1:${port}`;
  const target = origin + '/companion/';
  const allowed = (value) => {
    try {
      const url = new URL(value);
      return url.origin === origin && url.pathname.startsWith('/companion/');
    } catch {
      return false;
    }
  };
  app
    .whenReady()
    .then(async () => {
      const isolated = session.fromPartition('dsh-companion');
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(details.url) }));
      isolated.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        if (allowed(details.url)) headers['X-DSH-Pet-Token'] = token;
        callback({ requestHeaders: headers });
      });
      const window = new BrowserWindow({
        width: 460,
        height: 660,
        minWidth: 340,
        minHeight: 420,
        title: 'dsh-pet companion · GPT girl',
        backgroundColor: '#faf8ff',
        autoHideMenuBar: true,
        webPreferences: {
          session: isolated,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== target) event.preventDefault();
      });
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      await window.loadURL(target);
    })
    .catch(() => {
      process.stderr.write('Cannot open the local companion service.\n');
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
}
