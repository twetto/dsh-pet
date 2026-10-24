import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../runtime/avatar/catalog.cjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let ids;
try {
  const requested = process.argv[2] || process.env.DSH_PET_AVATAR || 'gpt';
  ids = requested === 'all' ? Object.keys(catalog.avatars) : [catalog.avatarId(requested)];
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const relative =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron';
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const electron = process.env.DSH_PET_ELECTRON_PATH || join(home, 'electron', relative);
if (!existsSync(electron)) throw new Error('找不到 Electron。請先設定 DSH_HOME 並執行 npm run ensure:electron。');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
for (const id of ids) {
  const child = spawn(electron, [join(root, 'runtime/avatar'), '--avatar=' + id], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('error', () => {
    console.error('無法啟動角色視窗。');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (code !== 0) process.exitCode = code ?? 1;
  });
}
