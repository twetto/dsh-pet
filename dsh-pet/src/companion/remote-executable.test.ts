import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { remoteExecutable } from './remote-executable';

test('Windows PTY resolves extensionless agy using child PATH, including its final entry and spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-remote-exe-'));
  try {
    const bin = join(root, 'native tools');
    mkdirSync(bin);
    const exe = join(bin, 'agy.exe');
    writeFileSync(exe, 'fixture');
    writeFileSync(join(root, 'agy.cmd'), 'must not run');
    const env = { Path: `"${root}";"${bin}"` };
    assert.equal(remoteExecutable('agy', root, env, 'win32'), exe);
    assert.equal(remoteExecutable('agy.exe', root, env, 'win32'), exe);
    assert.equal(remoteExecutable(exe, root, {}, 'win32'), exe);
    assert.equal(remoteExecutable(join('native tools', 'agy'), root, {}, 'win32'), exe);
    assert.throws(() => remoteExecutable('missing', root, env, 'win32'), /missing.*PATH.*DSH_PET_AGY_PATH/);
    assert.throws(() => remoteExecutable(join(root, 'agy.cmd'), root, env, 'win32'), /native executable/);
    assert.equal(remoteExecutable('agy', root, {}, 'linux'), 'agy');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
