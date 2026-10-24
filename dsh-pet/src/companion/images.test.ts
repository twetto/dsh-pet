import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, symlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { CompanionImages } from './images.ts';
import { ClaudeSession } from './claude-session.ts';
import { CompanionSession } from './session.ts';
import { exportConversation } from './portable.ts';
import { companionRoute } from './routes.ts';
import { listenStandaloneServer } from '../standalone/server.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { maxImageRequestBytes } from './image-limits.ts';

export const redPng =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
const fixture = fileURLToPath(new URL('../../scripts/tests/claude-protocol-fixture.mjs', import.meta.url));

function largePng(): Buffer {
  const original = Buffer.from(redPng, 'base64');
  const text = Buffer.from('Description\0' + 'x'.repeat(1024 * 1024));
  const data = Buffer.concat([Buffer.from('tEXt'), text]);
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length);
  data.copy(chunk, 4);
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]);
}

for (const provider of ['codex', 'claude'] as const)
  test(`${provider}: real HTTP boundary accepts image uploads above 1 MiB but preserves other request limits`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pet-large-image-http-'));
    const session =
      provider === 'claude'
        ? new ClaudeSession(directory, () => {}, process.execPath, [fixture])
        : new CompanionSession(directory);
    const base = provider === 'claude' ? '/companion/claude' : '/companion';
    const security = createRequestSecurity();
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const server = await listenStandaloneServer({
      routes: [companionRoute(session, provider)],
      logger,
      port: 0,
      security,
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
    try {
      const bytes = largePng();
      const body = JSON.stringify({ name: 'large.png', data: bytes.toString('base64') });
      assert.ok(Buffer.byteLength(body) > 1024 * 1024);
      const uploaded = await fetch(origin + base + '/images', { method: 'POST', headers, body });
      assert.equal(uploaded.status, 200);
      const info = (await uploaded.json()) as { id: string; size: number };
      assert.equal(info.size, bytes.length);
      const preview = await fetch(origin + base + '/images/' + info.id, { headers });
      assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
      assert.equal(
        (
          await fetch(origin + base + '/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
        ).status,
        403,
      );
      for (const path of [base + '/message', base + '/images/path', '/standalone-ai/settings'])
        assert.equal((await fetch(origin + path, { method: 'POST', headers, body })).status, 413);
      assert.equal(
        (
          await fetch(origin + base + '/images', {
            method: 'POST',
            headers,
            body: 'x'.repeat(maxImageRequestBytes + 1),
          })
        ).status,
        413,
      );
      assert.equal((await fetch(origin + base + '/images', { method: 'PUT', headers, body })).status, 413);
    } finally {
      await session.close();
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('private image uploads and explicit paths preserve their own copies and validate IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-image-'));
  try {
    const images = new CompanionImages(join(directory, 'images'));
    const uploaded = images.upload({ name: '../../red.png', data: redPng });
    assert.equal(uploaded.name, 'red.png');
    assert.equal(uploaded.mediaType, 'image/png');
    assert.equal(images.read(uploaded.id).bytes.toString('base64'), redPng);
    const path = join(directory, 'original.png');
    writeFileSync(path, Buffer.from(redPng, 'base64'));
    const copied = images.attachPath(pathToFileURL(path).href);
    writeFileSync(path, 'changed original');
    assert.equal(images.read(copied.id).bytes.toString('base64'), redPng);
    if (process.platform !== 'win32')
      assert.equal(statSync(join(directory, 'images', uploaded.id + '.bin')).mode & 0o777, 0o600);
    assert.throws(() => images.read('../original.png'), /Invalid image ID/);
    images.remove(uploaded.id);
    assert.throws(() => images.read(uploaded.id), /not found/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('images refuse non-image data, malformed base64, remote paths, oversized dimensions and storage overflow', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-image-invalid-'));
  try {
    const images = new CompanionImages(join(directory, 'images'));
    for (const data of ['!!', '', 'YQ==', Buffer.from('<svg onload="alert(1)"/>').toString('base64')])
      assert.throws(() => images.upload({ data }));
    assert.throws(() => images.attachPath('https://example.com/private.png'), /absolute/);
    assert.throws(() => images.attachPath('relative.png'), /absolute/);
    assert.throws(
      () => images.upload({ data: Buffer.from(redPng, 'base64').subarray(0, 40).toString('base64') }),
      /truncated/,
    );
    const huge = Buffer.from(redPng, 'base64');
    huge.writeUInt32BE(9000, 16);
    assert.throws(() => images.upload({ data: huge.toString('base64') }), /too large/);
    const sparse = join(directory, 'images', 'quota.bin');
    writeFileSync(sparse, '');
    truncateSync(sparse, 256 * 1024 * 1024);
    assert.throws(() => images.upload({ data: redPng }), /storage/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'explicit image paths reject links/devices and modified stored bytes',
  { skip: process.platform === 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'pet-image-link-'));
    try {
      const images = new CompanionImages(join(directory, 'images'));
      const path = join(directory, 'original.png');
      writeFileSync(path, Buffer.from(redPng, 'base64'));
      const link = join(directory, 'link.png');
      symlinkSync(path, link);
      assert.throws(() => images.attachPath(link), /regular image/);
      assert.throws(() => images.attachPath('/dev/zero'), /regular image/);
      const uploaded = images.upload({ data: redPng });
      const saved = join(directory, 'images', uploaded.id + '.bin');
      const changed = readFileSync(saved);
      changed[40] ^= 1;
      writeFileSync(saved, changed);
      assert.throws(() => images.read(uploaded.id), /validation/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('Claude sends real image blocks, saves references across restart, and protects sent images', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-image-chat-'));
  const create = () => new ClaudeSession(directory, () => {}, process.execPath, [fixture]);
  let session = create();
  try {
    const removed = session.images.upload({ data: redPng });
    session.discardImage(removed.id);
    const image = session.images.upload({ name: 'red.png', data: redPng });
    await session.send('', randomUUID(), [image.id]);
    for (let attempt = 0; attempt < 200 && session.snapshot().busy; attempt++) await setTimeout(10);
    assert.equal(session.snapshot().messages[1].text, 'Image received');
    assert.deepEqual(session.snapshot().messages[0].images, [image]);
    assert.throws(() => session.discardImage(image.id), /already sent/);
    await session.close();
    session = create();
    assert.deepEqual(session.snapshot().messages[0].images, [image]);
    assert.equal(session.images.read(image.id).bytes.toString('base64'), redPng);
    await session.close();
    assert.throws(() => exportConversation(join(directory, 'conversation.sqlite')), /image attachments/);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Claude image HTTP endpoints protect uploads/thumbnails and reject invalid IDs or unsupported providers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-image-http-'));
  const session = new ClaudeSession(directory, () => {}, process.execPath, [fixture]);
  const security = createRequestSecurity();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const server = await listenStandaloneServer({
    routes: [companionRoute(session, 'claude')],
    logger,
    port: 0,
    security,
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const base = origin + '/companion/claude';
  const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/images', { method: 'POST', body: '{}' })).status, 403);
    const uploaded = await post('/images', { name: 'red.png', data: redPng });
    assert.equal(uploaded.status, 200);
    const image = (await uploaded.json()) as { id: string };
    assert.equal((await fetch(base + '/images/' + image.id)).status, 403);
    const preview = await fetch(base + '/images/' + image.id, { headers });
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await preview.arrayBuffer()).toString('base64'), redPng);
    const unknown = await post('/message', { text: 'hello', id: randomUUID(), images: [randomUUID()] });
    assert.equal(unknown.status, 409);
    assert.equal((await post('/message', { text: '', id: randomUUID(), images: [image.id, image.id] })).status, 400);
    const evil = await fetch(base + '/images', {
      method: 'POST',
      headers: { ...headers, origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(evil.status, 403);
    assert.equal((await post('/images/path', { path: 'https://example.com/image.png' })).status, 409);
    const removed = await post('/images/remove', { id: image.id });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(base + '/images/' + image.id, { headers })).status, 404);
  } finally {
    await session.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
