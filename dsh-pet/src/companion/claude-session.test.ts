import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { ClaudeSession } from './claude-session.ts';
import { CompanionStore } from './store.ts';
import { companionRoute } from './routes.ts';
import { listenStandaloneServer } from '../standalone/server.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';

const fixture = fileURLToPath(new URL('../../scripts/tests/claude-protocol-fixture.mjs', import.meta.url));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'pet-claude-test-'));
  return {
    directory,
    create: () => new ClaudeSession(join(directory, 'claude'), () => {}, process.execPath, [fixture]),
  };
}
async function settled(session: ClaudeSession) {
  for (let attempt = 0; attempt < 200 && session.snapshot().busy; attempt++) await setTimeout(10);
  assert.equal(session.snapshot().busy, false);
}

test('Claude streams, finalizes, deduplicates and resumes a separate native conversation', async () => {
  const { directory, create } = setup();
  let session = create();
  try {
    const id = randomUUID();
    await session.send('hello', id);
    await assert.rejects(session.send('overlap', randomUUID()), /wait/);
    await settled(session);
    const saved = session.snapshot();
    assert.equal(saved.messages[1].text, 'Hello Claude');
    assert.equal(saved.messages[1].status, 'complete');
    await assert.rejects(session.send('duplicate', id), /already/);
    await assert.rejects(session.send('/tools', randomUUID()), /Slash/);
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

test('Claude stops without replay, preserves failures and reconnects', async () => {
  const { directory, create } = setup();
  const session = create();
  try {
    await session.send('wait', randomUUID());
    await setTimeout(100);
    await session.stop();
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

test('Claude rejects unsafe init, tool calls, malformed output, wrong sessions and disconnects', async () => {
  for (const text of ['unsafe', 'tool', 'bad-json', 'wrong-session', 'disconnect']) {
    const { directory, create } = setup();
    const session = create();
    try {
      await session.send(text, randomUUID());
      await settled(session);
      assert.equal(session.snapshot().connected, false);
      assert.equal(session.snapshot().messages[0].status, 'interrupted');
      assert.notEqual(session.snapshot().state, 'idle');
    } finally {
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('Claude refuses unsupported imported and foreign-OS context without replacing native IDs', async () => {
  for (const foreign of [true, false]) {
    const { directory, create } = setup();
    const store = new CompanionStore(join(directory, 'claude'));
    store.setMetadata('threadId', 'keep-original');
    store.setMetadata(foreign ? 'platform' : 'pendingContext', foreign ? 'another-os' : 'imported');
    store.close();
    const session = create();
    try {
      await assert.rejects(session.send('not sent', randomUUID()), /another OS|Portable/);
      assert.equal(session.snapshot().threadId, 'keep-original');
      assert.equal(session.snapshot().messages.length, 0);
    } finally {
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('Claude route requires the local capability and uses its own page/API namespace', async () => {
  const { directory, create } = setup();
  const session = create();
  const security = createRequestSecurity();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const server = await listenStandaloneServer({
    routes: [companionRoute(session, 'claude')],
    logger,
    port: 0,
    security,
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(origin + '/companion/claude/state')).status, 403);
    const page = await (await fetch(origin + '/companion/claude/', { headers })).text();
    assert.match(page, /<h1>Claude<\/h1>/);
    assert.match(page, /\/companion\/claude\/chat.js/);
    assert.equal((await fetch(origin + '/companion/gemini/state', { headers })).status, 404);
  } finally {
    await session.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
