import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { AgySession, checkAgyCustomizations } from './agy-session.ts';
import { CompanionStore } from './store.ts';
import { companionRoute } from './routes.ts';
import { listenStandaloneServer } from '../standalone/server.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { isRemoteControlUrl } from './remote-control.ts';
import { prepareAgyHome } from './agy-home.ts';
import { captureAgyTranscript } from './agy-transcript.ts';

const fixture = fileURLToPath(new URL('../../scripts/tests/agy-protocol-fixture.mjs', import.meta.url));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'pet-agy-test-'));
  const create = () => new AgySession(join(directory, 'gemini'), () => {}, process.execPath, [fixture], directory);
  return { directory, create };
}
async function settled(session: AgySession) {
  for (let attempt = 0; attempt < 200 && session.snapshot().busy; attempt++) await setTimeout(10);
  assert.equal(session.snapshot().busy, false);
}

test('Gemini streams, deduplicates, rejects overlaps and resumes its own native ID after restart', async () => {
  const { directory, create } = setup();
  let session = create();
  try {
    const id = randomUUID();
    await session.send('hello', id);
    await assert.rejects(session.send('overlap', randomUUID()), /wait/);
    await settled(session);
    const saved = session.snapshot();
    assert.equal(saved.messages[1].text, 'Hello Gemini');
    assert.equal(saved.messages[1].status, 'complete');
    await assert.rejects(session.send('duplicate', id), /already/);
    await assert.rejects(session.send('/model', randomUUID()), /Slash/);
    const agent = readFileSync(join(directory, 'gemini/workspace/.agents/agents/dsh-pet-gemini.md'), 'utf8');
    assert.match(agent, /tools: \[\]/);
    assert.match(agent, /subagent: false/);
    await session.close();
    session = create();
    await session.send('second', randomUUID());
    await settled(session);
    assert.equal(session.snapshot().threadId, saved.threadId);
    assert.equal(session.snapshot().messages.length, 4);
    const gpt = new CompanionStore(join(directory, 'gpt'));
    assert.equal(gpt.messages().length, 0);
    gpt.close();
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Gemini stop interrupts output, reconnects without replay, and retains failed turns', async () => {
  const { directory, create } = setup();
  const session = create();
  try {
    await session.send('wait', randomUUID());
    await session.stop();
    assert.equal(session.snapshot().connected, false);
    assert.equal(session.snapshot().messages[0].status, 'interrupted');
    await session.send('fail', randomUUID());
    await settled(session);
    assert.equal(session.snapshot().messages[1].status, 'failed');
    assert.match(session.snapshot().notice, /quota/);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Gemini aborts unexpected tool events and disconnects without retry', async () => {
  for (const input of ['tool', 'disconnect']) {
    const { directory, create } = setup();
    const session = create();
    try {
      await session.send(input, randomUUID());
      await settled(session);
      assert.equal(session.snapshot().connected, false);
      assert.equal(session.snapshot().messages.length, 1);
      assert.equal(session.snapshot().messages[0].status, 'interrupted');
    } finally {
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('Gemini refuses unverified hooks and auto-approval before sending a prompt', async () => {
  for (const variable of ['PET_TEST_AGY_BAD_HOOK', 'PET_TEST_AGY_UNSAFE']) {
    const { directory, create } = setup();
    const session = create();
    process.env[variable] = '1';
    try {
      await assert.rejects(session.send('not sent', randomUUID()), /confirm/);
      assert.equal(session.snapshot().messages.length, 0);
    } finally {
      delete process.env[variable];
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('Gemini refuses inherited global MCP/customization manifests without modifying them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-agy-config-'));
  const config = join(directory, '.gemini/config');
  mkdirSync(config, { recursive: true });
  try {
    const path = join(config, 'mcp_config.json');
    writeFileSync(path, '{"mcpServers":{"private":{"command":"no"}}}');
    assert.throws(() => checkAgyCustomizations(directory), /requires global/);
    assert.match(readFileSync(path, 'utf8'), /private/);
    writeFileSync(path, '{"mcpServers":{}}');
    checkAgyCustomizations(directory);
    mkdirSync(join(config, 'plugins'));
    checkAgyCustomizations(directory);
    writeFileSync(join(config, 'plugins', 'active.json'), '{}');
    assert.throws(() => checkAgyCustomizations(directory), /plugins/);
    rmSync(join(config, 'plugins'), { recursive: true });
    if (process.platform !== 'win32') {
      symlinkSync(directory, join(config, 'plugins'));
      assert.throws(() => checkAgyCustomizations(directory), /plugins/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Gemini Remote Control exclusively hands off the same ID and returns without replaying messages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-agy-remote-'));
  let onExit = () => {};
  let closed = false;
  let failClose = false;
  const url = 'https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc-v2';
  const session: AgySession = new AgySession(
    join(directory, 'chat'),
    () => {},
    process.execPath,
    [fixture],
    directory,
    (callback) => {
      onExit = callback;
      return {
        async start(executable, args, cwd) {
          assert.equal(executable, process.execPath);
          assert.equal(args[args.indexOf('--conversation') + 1], session.snapshot().threadId);
          assert.ok(args.includes('--remote-control'));
          assert.ok(args.includes('dsh-pet-gemini'));
          assert.ok(args.includes('plan'));
          assert.equal(cwd, join(directory, 'chat/workspace'));
          assert.equal(session.snapshot().connected, false);
          await assert.rejects(session.send('blocked', randomUUID()), /Remote Control/);
          return url;
        },
        async close() {
          if (failClose) throw new Error('Still running');
          closed = true;
          onExit();
        },
      };
    },
  );
  try {
    await assert.rejects(session.startRemoteControl(), /Send a message first/);
    await session.send('wait', randomUUID());
    await assert.rejects(session.startRemoteControl(), /Wait/);
    await session.stop();
    const thread = session.snapshot().threadId;
    const before = session.snapshot().messages;
    assert.equal(await session.startRemoteControl(), url);
    assert.deepEqual(session.snapshot().remoteControl, { status: 'active', url });
    await assert.rejects(session.startRemoteControl(), /Wait/);
    await assert.rejects(session.connect(), /Remote Control/);
    await assert.rejects(session.send('blocked', randomUUID()), /Remote Control/);
    failClose = true;
    await assert.rejects(session.returnFromRemoteControl(), /Still running/);
    assert.equal(session.snapshot().connected, false);
    await assert.rejects(session.send('still blocked', randomUUID()), /Remote Control/);
    failClose = false;
    await session.returnFromRemoteControl();
    assert.equal(closed, true);
    assert.equal(session.snapshot().threadId, thread);
    assert.equal(session.snapshot().connected, true);
    assert.equal(session.snapshot().remoteControl, null);
    assert.deepEqual(session.snapshot().messages, before);
    assert.match(session.snapshot().notice, /could not be synced/);
    await session.startRemoteControl();
    onExit();
    assert.equal(session.snapshot().remoteControl?.status, 'ended');
    await session.returnFromRemoteControl();
  } finally {
    failClose = false;
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Remote Control startup failure leaves chat resumable and URLs are narrowly validated', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-agy-remote-fail-'));
  const session = new AgySession(
    join(directory, 'chat'),
    () => {},
    process.execPath,
    [fixture],
    directory,
    () => ({
      async start() {
        throw new Error('Account unavailable');
      },
      async close() {},
    }),
  );
  try {
    await session.send('hello', randomUUID());
    await settled(session);
    await assert.rejects(session.startRemoteControl(), /Account unavailable/);
    assert.equal(session.snapshot().remoteControl, null);
    await session.send('second', randomUUID());
    await settled(session);
    assert.equal(session.snapshot().messages.length, 4);
    assert.ok(isRemoteControlUrl('https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc-v2'));
    for (const value of [
      'http://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc',
      'https://antigravity.google.com.evil/r/12345678-1234-4234-8234-123456789abc',
      'file:///tmp/test',
      'https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc?token=x',
    ])
      assert.equal(isRemoteControlUrl(value), false);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Gemini syncs external turns on return or graceful close without backfilling earlier gaps', async () => {
  for (const mode of ['return', 'close', 'older-gap']) {
    const directory = mkdtempSync(join(tmpdir(), 'pet-agy-sync-session-'));
    const thread = '12345678-1234-4234-8234-123456789abc';
    const log = join(directory, '.gemini/antigravity-cli/brain', thread, '.system_generated/logs/transcript.jsonl');
    mkdirSync(join(log, '..'), { recursive: true });
    const initial = new CompanionStore(join(directory, 'chat'));
    initial.setMetadata('threadId', thread);
    initial.setMetadata('platform', process.platform);
    if (mode === 'older-gap') initial.setMetadata('remoteHistoryGap', '1');
    initial.close();
    const row = (index: number, user: boolean, text: string) => ({
      step_index: index,
      status: 'DONE',
      created_at: '2026-10-24T10:19:41Z',
      source: user ? 'USER_EXPLICIT' : 'MODEL',
      type: user ? 'USER_INPUT' : 'PLANNER_RESPONSE',
      content: user ? '<USER_REQUEST>\n' + text + '\n</USER_REQUEST>' : text,
    });
    const rows = [row(0, true, 'Old missing message'), row(1, false, 'Old missing answer')];
    const save = () => writeFileSync(log, rows.map((value) => JSON.stringify(value)).join('\n') + '\n');
    save();
    const create = () =>
      new AgySession(
        join(directory, 'chat'),
        () => {},
        process.execPath,
        [fixture],
        directory,
        (onExit) => ({
          async start() {
            rows.push(row(2, true, 'New browser message'), row(3, false, 'New browser answer'));
            save();
            return 'https://antigravity.google.com/r/' + thread + '-v2';
          },
          async close() {
            onExit();
          },
        }),
      );
    let session = create();
    try {
      await session.startRemoteControl();
      if (mode === 'close') {
        await session.close();
        session = create();
      } else await session.returnFromRemoteControl();
      assert.deepEqual(
        session.snapshot().messages.map((message) => message.text),
        ['New browser message', 'New browser answer'],
      );
      assert.equal(session.snapshot().threadId, thread);
      if (mode === 'older-gap') assert.match(session.snapshot().notice, /Earlier.*not mirrored/);
      else if (mode === 'return') assert.match(session.snapshot().notice, /Synced 2/);
    } finally {
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('Gemini routes are capability protected and separate from GPT routes', async () => {
  const { directory, create } = setup();
  const session = create();
  const security = createRequestSecurity();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const server = await listenStandaloneServer({ routes: [companionRoute(session, 'agy')], logger, port: 0, security });
  const origin = `http://127.0.0.1:${server.port}`;
  const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(origin + '/companion/gemini/state')).status, 403);
    for (const endpoint of ['start', 'return'])
      assert.equal(
        (
          await fetch(origin + '/companion/gemini/remote/' + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        403,
      );
    const page = await (await fetch(origin + '/companion/gemini/', { headers })).text();
    assert.match(page, /<h1>Gemini<\/h1>/);
    assert.match(page, /\/companion\/gemini\/chat.js/);
    assert.equal((await fetch(origin + '/companion/state', { headers })).status, 404);
    const rejectedImage = await fetch(origin + '/companion/gemini/message', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Look at this', id: randomUUID(), images: [randomUUID()] }),
    });
    assert.equal(rejectedImage.status, 400);
    assert.match(((await rejectedImage.json()) as { error: string }).error, /text only/);
    assert.equal(session.snapshot().messages.length, 0);
    const result = await fetch(origin + '/companion/gemini/message', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello', id: randomUUID() }),
    });
    assert.equal(result.status, 200);
    await settled(session);
    assert.equal(session.snapshot().messages.length, 2);
  } finally {
    await session.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restart recovers failed browser image handoffs from a retained or verifiable legacy checkpoint', async () => {
  for (const mode of ['retained', 'legacy']) {
    const home = mkdtempSync(join(tmpdir(), 'pet-agy-recover-'));
    const thread = '12345678-1234-4234-8234-123456789abc';
    const ledger = join(home, 'chat');
    const alias = join(ledger, 'agy-home');
    prepareAgyHome(alias, home);
    const native = join(home, '.gemini/antigravity-cli/brain', thread);
    const log = join(native, '.system_generated/logs/transcript.jsonl');
    mkdirSync(join(log, '..'), { recursive: true });
    mkdirSync(join(native, '.user_uploaded'));
    const uri = join(alias, '.gemini/antigravity-cli/brain', thread, '.user_uploaded/image.png');
    writeFileSync(
      uri,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const row = (index: number, user: boolean, text: string) => ({
      step_index: index,
      status: 'DONE',
      created_at: '2026-10-24T10:19:41Z',
      source: user ? 'USER_EXPLICIT' : 'MODEL',
      type: user ? 'USER_INPUT' : 'PLANNER_RESPONSE',
      content: user ? '<USER_REQUEST>\n' + text + '\n</USER_REQUEST>' : text,
    });
    const before = [row(0, true, 'Hello'), row(1, false, 'Hi')];
    writeFileSync(log, before.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const checkpoint = captureAgyTranscript(home, thread);
    writeFileSync(
      log,
      [...before, { ...row(2, true, 'What color?'), media: [{ mime_type: 'image/png', uri }] }, row(3, false, 'Red')]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n',
    );
    const initial = new CompanionStore(ledger);
    initial.put({ id: randomUUID(), role: 'user', text: 'Hello', status: 'complete', created: 1 });
    initial.put({ id: randomUUID(), role: 'assistant', text: 'Hi\n', status: 'complete', created: 2 });
    initial.setMetadata('threadId', thread);
    initial.setMetadata('platform', process.platform);
    initial.setMetadata('remoteHistoryGap', '1');
    initial.setMetadata('remoteSyncWarning', 'Previous browser history sync failed');
    if (mode === 'retained')
      initial.setMetadata('agyRemoteCheckpoint', JSON.stringify({ threadId: thread, checkpoint, priorGap: false }));
    initial.close();
    const create = () => new AgySession(ledger, () => {}, process.execPath, [fixture], home);
    let session = create();
    try {
      assert.deepEqual(
        session.snapshot().messages.map((m) => m.text),
        ['Hello', 'Hi\n', 'What color?', 'Red'],
      );
      assert.equal(session.snapshot().messages[2].images?.length, 1);
      assert.match(session.snapshot().notice, /Synced 2/);
      await session.close();
      session = create();
      assert.equal(session.snapshot().messages.length, 4);
      assert.equal(session.snapshot().threadId, thread);
    } finally {
      await session.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
});
