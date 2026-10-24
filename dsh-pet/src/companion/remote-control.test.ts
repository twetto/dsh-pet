import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgyRemoteControl } from './remote-control.ts';

test('managed PTY handles trust, fragmented URLs and closes its temporary session', async (context) => {
  try {
    await import('node-pty');
  } catch {
    context.skip('Optional native PTY not installed');
    return;
  }
  let exited = false;
  const remote = new AgyRemoteControl(() => {
    exited = true;
  });
  const expected =
    'https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc-v2?p=c%2F12345678-1234-4234-8234-123456789abc';
  const script = `
    process.stdout.write('Do you trust the contents of this project?');
    let trusted = false;
    process.stdin.on('data', data => {
      if (String(data).includes('/exit')) return process.exit(0);
      if (trusted) return;
      trusted = true;
      process.stdout.write('\\nRemote control on for this session.\\nhttps://antigravity.google.com/r/12345678-');
      setTimeout(() => process.stdout.write('1234-4234-8234-123456789abc-v2?p=c%2F12345678-1234-4234-8234-123456789abc on another device.\\n'), 20);
    });
  `;
  try {
    assert.equal(
      await remote.start(
        process.execPath,
        ['-e', script, '--', '--conversation', '12345678-1234-4234-8234-123456789abc'],
        process.cwd(),
      ),
      expected,
    );
    await remote.close();
    assert.equal(exited, true);
  } finally {
    await remote.close();
  }
});

test('managed PTY reports account failure and cleans up without a persistent daemon', async (context) => {
  try {
    await import('node-pty');
  } catch {
    context.skip('Optional native PTY not installed');
    return;
  }
  let exited = false;
  const remote = new AgyRemoteControl(() => {
    exited = true;
  });
  const script =
    "console.log('Remote control is not enabled for your account.'); process.stdin.on('data', () => process.exit(0));";
  await assert.rejects(remote.start(process.execPath, ['-e', script], process.cwd()), /not enabled/);
  assert.equal(exited, true);
});
