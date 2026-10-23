import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CompanionStore } from './store.ts';
import { CompanionSession } from './session.ts';
import { CodexProtocol } from './protocol.ts';
import type { Payload } from './protocol.ts';
import { companionRoute } from './routes.ts';
import { listenStandaloneServer } from '../standalone/server.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { exportConversation, savePortable, validatePortable, fingerprint, historicalContext } from './portable.ts';

class FakeCodex extends CodexProtocol {
  calls: { method: string; params: Payload }[] = [];
  override async connect() {}
  override async request(method: string, params: Payload): Promise<Payload> {
    this.calls.push({ method, params });
    if (method.startsWith('thread/')) return { thread: { id: 'test-thread' } };
    return { turn: { id: 'test-turn' } };
  }
  override close() {}
  notify(method: string, params: Payload) {
    this.onNotification(method, { threadId: 'test-thread', ...params });
  }
}

test('ledger preserves messages/thread across restart, deduplicates and marks interrupted output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-ledger-'));
  try {
    let store = new CompanionStore(directory);
    assert.throws(() => new CompanionStore(directory), /already owns/);
    store.setMetadata('threadId', 'saved');
    store.put({ id: 'one', role: 'assistant', text: 'partial', status: 'streaming', created: 1 });
    store.put({ id: 'one', role: 'assistant', text: 'updated', status: 'streaming', created: 1 });
    store.close();
    store = new CompanionStore(directory);
    assert.equal(store.metadata('threadId'), 'saved');
    assert.equal(store.messages().length, 1);
    assert.equal(store.messages()[0].text, 'updated');
    assert.equal(store.messages()[0].status, 'interrupted');
    if (process.platform !== 'win32')
      assert.equal(statSync(join(directory, 'conversation.sqlite')).mode & 0o777, 0o600);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ledger refuses symbolic-link databases', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-symlink-'));
  try {
    symlinkSync('/dev/null', join(directory, 'conversation.sqlite'));
    assert.throws(() => new CompanionStore(directory), /Unsafe/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('session streams/finalizes once, resumes saved thread and rejects overlapping/duplicate sends', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-session-'));
  const client = new FakeCodex();
  const states: string[] = [];
  let session = new CompanionSession(directory, (state) => states.push(state), client);
  try {
    const id = randomUUID();
    await session.send('hello', id);
    await assert.rejects(session.send('overlap', randomUUID()));
    assert.equal(client.calls[0].method, 'thread/start');
    assert.equal(client.calls[0].params.sandbox, 'read-only');
    client.notify('item/agentMessage/delta', { itemId: 'answer', delta: 'Hello' });
    client.notify('item/completed', { item: { type: 'agentMessage', id: 'answer', text: 'Hello there' } });
    client.notify('turn/completed', { turn: { id: 'test-turn', status: 'completed' } });
    assert.equal(session.snapshot().messages[1].text, 'Hello there');
    assert.equal(session.snapshot().messages[1].status, 'complete');
    assert.deepEqual(states, ['thinking', 'idle']);
    await assert.rejects(session.send('duplicate', id));
    await session.close();
    const resumed = new FakeCodex();
    session = new CompanionSession(directory, () => {}, resumed);
    await session.connect();
    assert.equal(resumed.calls[0].method, 'thread/resume');
    assert.equal(resumed.calls[0].params.threadId, 'test-thread');
    assert.equal(session.snapshot().messages.length, 2);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('protocol denies escalation requests and rejects pending calls on disconnect', async () => {
  const fixture = fileURLToPath(new URL('../../scripts/tests/companion-protocol-fixture.mjs', import.meta.url));
  const client = new CodexProtocol(process.execPath, [fixture]);
  let denied = 0;
  client.onDenied = () => denied++;
  try {
    await client.connect();
    assert.deepEqual(await client.request('probe/approval', {}), { decision: 'decline' });
    assert.equal(denied, 1);
    await assert.rejects(client.request('probe/disconnect', {}), /disconnected/);
  } finally {
    client.close();
  }
});

test('copied foreign-OS ledger is not silently resumed or replaced', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-foreign-'));
  const store = new CompanionStore(directory);
  store.setMetadata('threadId', 'original-thread');
  store.setMetadata('platform', 'another-os');
  store.close();
  const client = new FakeCodex();
  const session = new CompanionSession(directory, () => {}, client);
  try {
    await assert.rejects(session.connect(), /another OS/);
    assert.equal(session.snapshot().threadId, 'original-thread');
    assert.equal(client.calls.length, 0);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('companion HTML and private transcript require capability; writes reject bad origins and invalid input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-http-'));
  const session = new CompanionSession(directory, () => {}, new FakeCodex());
  const security = createRequestSecurity();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const server = await listenStandaloneServer({ routes: [companionRoute(session)], logger, port: 0, security });
  const origin = `http://127.0.0.1:${server.port}`;
  const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
  try {
    for (const path of ['/companion/', '/companion/state', '/companion/chat.js'])
      assert.equal((await fetch(origin + path)).status, 403);
    assert.equal((await fetch(origin + '/companion/', { headers })).status, 200);
    assert.equal(
      (await fetch(origin + '/companion/state', { headers: { ...headers, origin: 'https://evil.example' } })).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + '/companion/message', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: '', id: randomUUID() }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(origin + '/companion/message', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'hello', id: randomUUID() }),
        })
      ).status,
      200,
    );
    const state = (await (await fetch(origin + '/companion/state', { headers })).json()) as { messages: unknown[] };
    assert.equal(state.messages.length, 1);
  } finally {
    await server.close();
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('portable export includes full ledger, not native metadata, and refuses active or overwritten output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-export-'));
  const store = new CompanionStore(directory);
  try {
    store.setMetadata('threadId', 'do-not-transfer-native-thread');
    store.setMetadata('credential-test', 'do-not-transfer-secret');
    for (let index = 0; index < 205; index++)
      store.put({ id: `message-${index}`, role: 'user', text: 'text', status: 'complete', created: index });
    assert.equal(store.messages().length, 200);
    const snapshot = exportConversation(join(directory, 'conversation.sqlite'));
    assert.equal(snapshot.messages.length, 205);
    assert.ok(!JSON.stringify(snapshot).includes('do-not-transfer'));
    const path = join(directory, 'snapshot.json');
    savePortable(path, snapshot);
    assert.throws(() => savePortable(path, snapshot), /EEXIST/);
    store.put({ id: 'pending', role: 'user', text: 'not finished', status: 'pending', created: 206 });
    assert.throws(() => exportConversation(join(directory, 'conversation.sqlite')), /unfinished/);
    assert.throws(() => store.importConversation(snapshot), /Stale or conflicting/);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('portable validation rejects tampering, duplicate IDs and unsupported versions', () => {
  const messages = [{ id: 'one', role: 'user', text: 'hello', status: 'complete', created: 1 }];
  const snapshot = {
    format: 'dsh-companion',
    version: 1,
    source: 'linux',
    exported: 1,
    digest: fingerprint(messages),
    messages,
  };
  assert.equal(validatePortable(snapshot).messages.length, 1);
  assert.throws(() => validatePortable({ ...snapshot, version: 99 }), /unsupported/);
  assert.throws(() => validatePortable({ ...snapshot, messages: [{ ...messages[0], text: 'tampered' }] }), /checksum/);
  assert.throws(() => validatePortable({ ...snapshot, messages: [messages[0], messages[0]] }), /duplicate/);
  assert.throws(() => validatePortable({ ...snapshot, messages: [{ ...messages[0], role: 'system' }] }), /invalid/);
});

test('import is fast-forward only, identical snapshot preserves thread, and conflict changes nothing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-import-'));
  const store = new CompanionStore(directory);
  const messages = [{ id: 'one', role: 'user', text: 'first', status: 'complete', created: 1 }];
  const snapshot = {
    format: 'dsh-companion',
    version: 1,
    source: 'win32',
    exported: 1,
    digest: fingerprint(messages),
    messages,
  };
  try {
    assert.equal(store.importConversation(snapshot).added, 1);
    assert.equal(store.metadata('threadId'), undefined);
    assert.ok(store.metadata('pendingContext')?.includes('first'));
    store.setMetadata('threadId', 'keep-for-identical');
    assert.equal(store.importConversation(snapshot).added, 0);
    assert.equal(store.metadata('threadId'), 'keep-for-identical');
    const changed = [{ ...messages[0], text: 'unrelated branch' }];
    assert.throws(
      () => store.importConversation({ ...snapshot, messages: changed, digest: fingerprint(changed) }),
      /conflicting/,
    );
    assert.equal(store.messages()[0].text, 'first');
    assert.equal(store.metadata('threadId'), 'keep-for-identical');
    const newer = [...messages, { id: 'two', role: 'assistant', text: 'second', status: 'complete', created: 2 }];
    assert.equal(store.importConversation({ ...snapshot, messages: newer, digest: fingerprint(newer) }).added, 1);
    assert.equal(store.metadata('threadId'), undefined);
    assert.throws(() => store.importConversation(snapshot), /Stale/);
    assert.equal(store.messages().length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('imported context starts fresh, is sent once, and is not inserted as duplicate ledger turns', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-context-'));
  const store = new CompanionStore(directory);
  const messages = [
    { id: 'historical', role: 'user', text: 'My favorite color is lavender.', status: 'complete', created: 1 },
  ];
  store.importConversation({
    format: 'dsh-companion',
    version: 1,
    source: 'win32',
    exported: 1,
    digest: fingerprint(messages),
    messages,
  });
  store.close();
  const client = new FakeCodex();
  const session = new CompanionSession(directory, () => {}, client);
  try {
    assert.match(session.snapshot().notice, /win32/);
    await session.send('What is my favorite color?', randomUUID());
    assert.equal(client.calls[0].method, 'thread/start');
    const input = client.calls[1].params.input as { text: string }[];
    assert.match(input[0].text, /quoted data/);
    assert.match(input[0].text, /lavender/);
    assert.equal(session.snapshot().messages.length, 2);
    client.notify('turn/completed', { turn: { status: 'completed' } });
    await session.send('And now?', randomUUID());
    const next = client.calls[2].params.input as { text: string }[];
    assert.equal(next[0].text, 'And now?');
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('context restore bounds long history rather than pretending to load everything', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: String(index),
    role: 'user',
    text: 'x'.repeat(30000),
    status: 'complete',
    created: index,
  }));
  const context = historicalContext(messages);
  assert.ok(context.length < 26000);
  assert.match(context, /truncated/);
  assert.match(context, /bounded recent excerpt/);
});
