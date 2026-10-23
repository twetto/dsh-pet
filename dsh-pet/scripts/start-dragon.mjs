import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = join(root, 'runtime/quickshell/shell.qml');
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const manifest = join(home, 'dsh-pet/standalone-runtime.json');

async function runningService() {
  try {
    const runtime = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535) return;
    const response = await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal: AbortSignal.timeout(1500) });
    const status = await response.json();
    if (response.ok && status.name === 'dsh-pet-standalone' && status.pid === runtime.pid) return runtime;
  } catch {}
}

try {
  if (process.platform !== 'linux' || !process.env.WAYLAND_DISPLAY)
    throw new Error('Run dragon from your Linux Wayland desktop.');
  if (spawnSync('qs', ['--version'], { stdio: 'ignore' }).status !== 0) throw new Error('Quickshell is not available.');
  if (!existsSync(join(root, 'lib/standalone.js'))) throw new Error('Build the project with npm run bundle first.');
  let service = await runningService();
  if (service && (!service.companion || service.pluginRoot !== root.replace(/\/$/, '')))
    throw new Error('Another service is running without this companion configuration. Stop it before running dragon.');
  if (!service) {
    const directory = join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'dsh-pet');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe log directory.');
    chmodSync(directory, 0o700);
    const log = join(directory, 'companion-service.log');
    if (existsSync(log) && (!lstatSync(log).isFile() || lstatSync(log).isSymbolicLink()))
      throw new Error('Unsafe service log.');
    const descriptor = openSync(log, 'a', 0o600);
    chmodSync(log, 0o600);
    const child = spawn(process.execPath, [join(root, 'lib/standalone.js'), '--port', '3080'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', descriptor, descriptor],
      env: { ...process.env, DSH_PET_EXTERNAL_FRONTEND: '1', DSH_PET_COMPANION: '1' },
    });
    child.on('error', () => {});
    child.unref();
    closeSync(descriptor);
    for (let attempt = 0; attempt < 60; attempt++) {
      await setTimeout(250);
      service = await runningService();
      if (service) break;
    }
    if (!service?.companion || service.pluginRoot !== root.replace(/\/$/, ''))
      throw new Error(`Service did not become ready. Check ${log}`);
  }
  const launched = spawnSync('qs', ['-d', '-n', '-p', config], {
    env: { ...process.env, DSH_PET_AVATAR: 'gpt-girl', QT_QPA_PLATFORM: 'wayland' },
    stdio: 'inherit',
  });
  if (launched.status !== 0) throw new Error('Could not launch the avatar.');
  for (let attempt = 0; attempt < 20; attempt++) {
    const selected = spawnSync('qs', ['ipc', '-p', config, 'call', 'pet', 'avatar', 'gpt-girl'], { stdio: 'ignore' });
    if (selected.status === 0) {
      console.log('Dragon girl is ready. Right-click her → Chat with GPT girl.');
      process.exit(0);
    }
    await setTimeout(250);
  }
  throw new Error('Avatar started but is not ready for interaction yet.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
