import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const runtime = JSON.parse(readFileSync(join(home, 'dsh-pet', 'standalone-runtime.json'), 'utf8'));
if (!runtime.companion)
  throw new Error('Restart the service with DSH_PET_COMPANION=1 first. See runtime/companion/README.md.');
const executable =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron';
const electron = process.env.DSH_PET_ELECTRON_PATH || join(home, 'electron', executable);
if (!existsSync(electron)) throw new Error('Electron not found; set DSH_PET_ELECTRON_PATH.');
const health = await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal: AbortSignal.timeout(3000) });
const status = await health.json();
if (!health.ok || status.pid !== runtime.pid || status.name !== 'dsh-pet-standalone')
  throw new Error('The saved service is no longer running.');
const env = { ...process.env, DSH_PET_CHAT_PORT: String(runtime.port), DSH_PET_CHAT_TOKEN: runtime.token };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, 'runtime/companion')], { cwd: root, env, stdio: 'inherit' });
child.on('error', () => {
  console.error('Cannot launch Electron.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
