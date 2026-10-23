import { closeSync, existsSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export function acquireCompanionLock(directory: string): () => void {
  const path = join(directory, 'writer.lock');
  if (existsSync(path)) {
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe companion lock');
    const previous = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown; platform?: string };
    if (previous.platform !== process.platform || !Number.isInteger(previous.pid) || Number(previous.pid) < 1)
      throw new Error('Companion lock needs manual inspection');
    let alive = true;
    try {
      process.kill(Number(previous.pid), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('Another companion service already owns this conversation');
    unlinkSync(path);
  }
  const identity = JSON.stringify({ pid: process.pid, platform: process.platform, nonce: randomUUID() });
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, identity);
  } finally {
    closeSync(descriptor);
  }
  return () => {
    if (existsSync(path) && readFileSync(path, 'utf8') === identity) unlinkSync(path);
  };
}
