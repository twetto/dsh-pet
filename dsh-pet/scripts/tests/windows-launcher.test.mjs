import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWindows, runningService } from '../start-windows.mjs';

const binary = process.env.DSH_PET_ELECTRON_PATH;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test(
  'one-click Windows launcher starts a clean service, reuses it and shuts it down gracefully',
  { timeout: 45000 },
  async (context) => {
    if (process.platform !== 'win32' || !binary || !existsSync(binary)) {
      context.skip('Windows Electron required');
      return;
    }
    const home = mkdtempSync(join(tmpdir(), 'pet-launcher-test-'));
    const env = { ...process.env, DSH_HOME: home, DSH_PET_ELECTRON_PATH: binary };
    let first;
    try {
      first = await runWindows('all', env);
      assert.equal(first.reused, false);
      assert.equal(first.avatarPids.length, 3);
      assert.equal((await runningService(home)).pid, first.servicePid);
      await sleep(1000);
      assert.ok(first.avatarPids.every(alive));
      const repeated = await runWindows('all', env);
      assert.equal(repeated.reused, true);
      assert.equal(repeated.servicePid, first.servicePid);
      for (let i = 0; i < 60 && repeated.avatarPids.some(alive); i++) await sleep(100);
      assert.ok(
        repeated.avatarPids.every((pid) => !alive(pid)),
        'duplicate instances exit',
      );
      assert.ok(first.avatarPids.every(alive), 'original three windows remain');
      await runWindows('--stop', env);
      for (let i = 0; i < 100 && (alive(first.servicePid) || first.avatarPids.some(alive)); i++) await sleep(100);
      assert.equal(alive(first.servicePid), false);
      assert.ok(first.avatarPids.every((pid) => !alive(pid)));
      assert.equal(await runningService(home), undefined);
    } finally {
      await runWindows('--stop', env);
    }
  },
);
