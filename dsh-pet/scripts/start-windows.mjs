import { spawn } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import catalog from '../runtime/avatar/catalog.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const samePath = (a, b) => typeof a === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase();

export async function runningService(home) {
  let runtime;
  try {
    const path = join(home, 'dsh-pet/standalone-runtime.json');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error();
    runtime = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535) return;
    const response = await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal: AbortSignal.timeout(1500) });
    const status = await response.json();
    if (!response.ok || status.name !== 'dsh-pet-standalone' || status.pid !== runtime.pid) return;
  } catch {
    return;
  }
  if (!samePath(runtime.pluginRoot, root)) throw new Error('此資料目錄的服務來自另一份 repo，請先關閉該服務。');
  if (
    !runtime.companion ||
    !runtime.geminiCompanion ||
    !runtime.claudeCompanion ||
    !/^[A-Za-z0-9_-]{43}$/.test(runtime.token || '')
  )
    throw new Error('現有服務未啟用完整 companion 功能，請先關閉該服務後再啟動。');
  return runtime;
}

async function detached(executable, args, env, log) {
  if (existsSync(log) && (!lstatSync(log).isFile() || lstatSync(log).isSymbolicLink()))
    throw new Error('啟動日誌檔案不安全。');
  const descriptor = openSync(log, 'a', 0o600);
  try {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', descriptor, descriptor],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return child;
  } finally {
    closeSync(descriptor);
  }
}

export async function runWindows(requested = 'all', env = process.env) {
  if (process.platform !== 'win32') throw new Error('此啟動檔用於 Windows。');
  const stop = requested === '--stop';
  const ids = requested === 'all' || stop ? Object.keys(catalog.avatars) : [catalog.avatarId(requested)];
  const home = env.DSH_HOME || join(env.LOCALAPPDATA, 'dsh-pet-windows-smoke');
  const electron = env.DSH_PET_ELECTRON_PATH || join(home, 'electron/electron.exe');
  const childEnv = { ...env, DSH_HOME: home, DSH_PET_EXTERNAL_FRONTEND: '1', DSH_PET_COMPANION: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const logs = join(home, 'dsh-pet/launcher-logs');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  if (!lstatSync(logs).isDirectory() || lstatSync(logs).isSymbolicLink()) throw new Error('啟動日誌目錄不安全。');
  let service = await runningService(home);
  const reused = !!service;
  if (stop) {
    if (existsSync(electron))
      for (const id of ids)
        await detached(
          electron,
          [join(root, 'runtime/avatar'), '--avatar=' + id, '--quit-avatar'],
          childEnv,
          join(logs, 'avatar.log'),
        );
    if (service) {
      const response = await fetch(`http://127.0.0.1:${service.port}/shutdown`, {
        method: 'POST',
        headers: { 'X-DSH-Pet-Token': service.token },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('服務拒絕停機要求，未強制終止程序。');
      console.log('已要求角色與聊天服務正常關閉。');
    } else console.log('已關閉角色；聊天服務未在執行。');
    return;
  }
  if (!existsSync(electron)) throw new Error('找不到 Electron。請在 dsh-pet 目錄執行 npm run ensure:electron。');
  if (!service) {
    if (!existsSync(join(root, 'lib/standalone.js')))
      throw new Error('缺少建置產物。請在 dsh-pet 目錄執行 npm run build。');
    const log = join(logs, 'service.log');
    if (existsSync(log) && (!lstatSync(log).isFile() || lstatSync(log).isSymbolicLink()))
      throw new Error('服務日誌檔案不安全。');
    await detached(process.execPath, [join(root, 'lib/standalone.js'), '--port', '3080'], childEnv, log);
    for (let attempt = 0; attempt < 100; attempt++) {
      await setTimeout(200);
      service = await runningService(home);
      if (service) break;
    }
    if (!service) throw new Error(`聊天服務未能啟動，請查看 ${log}`);
    console.log('聊天服務已啟動。');
  } else console.log('沿用已執行的聊天服務。');
  const avatarPids = [];
  for (const id of ids) {
    const child = await detached(
      electron,
      [join(root, 'runtime/avatar'), '--avatar=' + id],
      childEnv,
      join(logs, 'avatar.log'),
    );
    avatarPids.push(child.pid);
  }
  console.log('角色已啟動：' + ids.map((id) => catalog.avatars[id].label).join('、'));
  console.log('完整關閉可雙擊 repo 根目錄的 Stop-Pets.cmd。');
  return { servicePid: service.pid, reused, avatarPids };
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  runWindows(process.argv[2] || 'all').catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
