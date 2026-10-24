import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { captureAgyTranscript, importAgyTranscript, recoverAgyTranscriptCheckpoint } from './agy-transcript.ts';
import { CompanionStore } from './store.ts';
import { CompanionImages } from './images.ts';
import { prepareAgyHome } from './agy-home.ts';

const thread = '12345678-1234-4234-8234-123456789abc';
const redPng =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
function user(text: string) {
  return {
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    content:
      '<USER_REQUEST>\n' + text + '\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nHidden metadata\n</ADDITIONAL_METADATA>',
  };
}
function assistant(text: string) {
  return { source: 'MODEL', type: 'PLANNER_RESPONSE', content: text, thinking: 'Never display this field' };
}
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'pet-agy-transcript-'));
  const root = join(home, '.gemini/antigravity-cli/brain', thread);
  const log = join(root, '.system_generated/logs/transcript.jsonl');
  const media = join(root, '.user_uploaded/red.png');
  mkdirSync(join(root, '.system_generated/logs'), { recursive: true });
  mkdirSync(join(root, '.user_uploaded'));
  writeFileSync(media, Buffer.from(redPng, 'base64'));
  const store = new CompanionStore(join(home, 'ledger'));
  const images = new CompanionImages(join(home, 'images'));
  const write = (rows: Record<string, unknown>[]) =>
    writeFileSync(
      log,
      rows
        .map((row, index) =>
          JSON.stringify({ step_index: index, status: 'DONE', created_at: '2026-10-24T10:19:41Z', ...row }),
        )
        .join('\n') + '\n',
    );
  write([]);
  const close = () => {
    store.close();
    rmSync(home, { recursive: true, force: true });
  };
  return { home, root, log, media, store, images, write, close };
}

test('native transcript imports only external visible messages and scoped images, idempotently', () => {
  const state = setup();
  const { home, media, store, images, write } = state;
  try {
    const local = [user('Already shown'), assistant('Already answered')];
    write(local);
    store.put({ id: 'local-user', role: 'user', text: 'Already shown', status: 'complete', created: 1 });
    store.put({ id: 'local-answer', role: 'assistant', text: 'Already answered', status: 'complete', created: 2 });
    const checkpoint = captureAgyTranscript(home, thread);
    write([
      ...local,
      { ...user('What color?'), media: [{ mime_type: 'image/png', uri: media }] },
      { source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: 'Hidden system message' },
      assistant('Red'),
    ]);
    assert.equal(importAgyTranscript(home, thread, checkpoint, store, images, { cursor: 'done' }), 2);
    assert.deepEqual(
      store.messages().map((message) => message.text),
      ['Already shown', 'Already answered', 'What color?', 'Red'],
    );
    assert.equal(store.metadata('cursor'), 'done');
    const image = store.messages()[2].images![0];
    assert.equal(images.read(image.id).bytes.toString('base64'), redPng);
    assert.equal(importAgyTranscript(home, thread, checkpoint, store, images), 0);
    assert.equal(store.messages().length, 4);
    assert.equal(readdirSync(join(home, 'images')).filter((name) => name.endsWith('.bin')).length, 1);
    rmSync(media);
    assert.equal(images.read(image.id).bytes.toString('base64'), redPng);
    assert.equal(importAgyTranscript(home, thread, captureAgyTranscript(home, thread), store, images), 0);
  } finally {
    state.close();
  }
});

test('rewinds, changed prefix, truncated/incomplete/unknown steps and partial JSON leave the ledger unchanged', () => {
  for (const kind of ['rewind', 'prefix', 'truncated', 'incomplete', 'unknown', 'partial', 'wrapper']) {
    const state = setup();
    const { home, store, images, write, log } = state;
    try {
      const before = [user('Before'), assistant('Before answer')];
      write(before);
      const checkpoint = captureAgyTranscript(home, thread);
      if (kind === 'rewind') write([before[0]]);
      if (kind === 'prefix') write([user('Changed'), before[1], user('After')]);
      if (kind === 'truncated') write([...before, { ...user('After'), truncated_fields: ['content'] }]);
      if (kind === 'incomplete') write([...before, { ...assistant('Partial'), status: 'ACTIVE' }]);
      if (kind === 'unknown') write([...before, { source: 'MODEL', type: 'FUTURE_RESPONSE', content: 'Unknown' }]);
      if (kind === 'partial') writeFileSync(log, '{"step_index":');
      if (kind === 'wrapper') write([...before, { ...user('After'), content: 'Unknown wrapping' }]);
      assert.throws(() => importAgyTranscript(home, thread, checkpoint, store, images));
      assert.equal(store.messages().length, 0);
    } finally {
      state.close();
    }
  }
});

test('staged images and message/cursor writes roll back together on an import failure', () => {
  const state = setup();
  const { home, media, store, images, write } = state;
  try {
    const checkpoint = captureAgyTranscript(home, thread);
    write([{ ...user('Image'), media: [{ mime_type: 'image/png', uri: media }] }, assistant('Answer')]);
    store.setMetadata('cursor', 'before');
    const put = store.put.bind(store);
    let calls = 0;
    store.put = (message) => {
      if (++calls === 2) throw new Error('Simulated database failure');
      put(message);
    };
    assert.throws(() => importAgyTranscript(home, thread, checkpoint, store, images, { cursor: 'after' }), /Simulated/);
    assert.equal(store.messages().length, 0);
    assert.equal(store.metadata('cursor'), 'before');
    assert.deepEqual(readdirSync(join(home, 'images')), []);
    store.put = put;
    assert.equal(importAgyTranscript(home, thread, checkpoint, store, images, { cursor: 'after' }), 2);
    assert.equal(store.metadata('cursor'), 'after');
  } finally {
    state.close();
  }
});

test('native image imports reject paths outside this conversation and symlinked files/directories', () => {
  for (const kind of [
    'outside',
    'other-conversation',
    'url',
    ...(process.platform === 'win32' ? [] : ['file-link', 'directory-link']),
  ]) {
    const state = setup();
    const { home, media, root, store, images, write } = state;
    try {
      const checkpoint = captureAgyTranscript(home, thread);
      const outside = join(home, 'outside.png');
      writeFileSync(outside, Buffer.from(redPng, 'base64'));
      let path = kind === 'url' ? 'https://example.com/image.png' : outside;
      if (kind === 'other-conversation') {
        path = join(
          home,
          '.gemini/antigravity-cli/brain/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/.user_uploaded/image.png',
        );
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, Buffer.from(redPng, 'base64'));
      }
      if (kind === 'file-link') {
        rmSync(media);
        symlinkSync(outside, media);
        path = media;
      }
      if (kind === 'directory-link') {
        rmSync(join(root, '.user_uploaded'), { recursive: true });
        symlinkSync(home, join(root, '.user_uploaded'));
        path = join(root, '.user_uploaded/outside.png');
      }
      write([{ ...user('Unsafe image'), media: [{ mime_type: 'image/png', uri: path }] }]);
      assert.throws(() => importAgyTranscript(home, thread, checkpoint, store, images));
      assert.equal(store.messages().length, 0);
      assert.deepEqual(readdirSync(join(home, 'images')), []);
    } finally {
      state.close();
    }
  }
});

test('transcript reads are bounded and reject invalid IDs and linked log files', () => {
  const state = setup();
  try {
    assert.throws(() => captureAgyTranscript(state.home, '../other'));
    truncateSync(state.log, 33 * 1024 * 1024);
    assert.throws(() => captureAgyTranscript(state.home, thread), /oversized/);
    if (process.platform !== 'win32') {
      rmSync(state.log);
      symlinkSync(state.media, state.log);
      assert.throws(() => captureAgyTranscript(state.home, thread), /Unsafe/);
    }
  } finally {
    state.close();
  }
});

test('image paths through the approved isolated brain alias import without allowing other junctions', () => {
  const state = setup();
  const { home, store, images, write } = state;
  const alias = join(home, 'isolated');
  try {
    prepareAgyHome(alias, home);
    const checkpoint = captureAgyTranscript(home, thread);
    const uri = join(alias, '.gemini/antigravity-cli/brain', thread, '.user_uploaded/red.png');
    write([{ ...user('Alias upload'), media: [{ mime_type: 'image/png', uri }] }, assistant('Red')]);
    assert.throws(() => importAgyTranscript(home, thread, checkpoint, store, images), /outside/);
    assert.equal(importAgyTranscript(home, thread, checkpoint, store, images, {}, alias), 2);
    assert.equal(images.read(store.messages()[0].images![0].id).bytes.toString('base64'), redPng);
    assert.equal(importAgyTranscript(home, thread, checkpoint, store, images, {}, alias), 0);
    const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const outside = join(alias, '.gemini/antigravity-cli/brain', other, '.user_uploaded/other.png');
    mkdirSync(join(outside, '..'), { recursive: true });
    writeFileSync(outside, Buffer.from(redPng, 'base64'));
    const next = captureAgyTranscript(home, thread);
    const rows = [{ ...user('Alias upload'), media: [{ mime_type: 'image/png', uri }] }, assistant('Red')];
    write([...rows, { ...user('Wrong thread'), media: [{ mime_type: 'image/png', uri: outside }] }]);
    assert.throws(() => importAgyTranscript(home, thread, next, store, images, {}, alias), /outside/);
    assert.equal(store.messages().length, 2);
    unlinkSync(join(alias, '.gemini/antigravity-cli/brain'));
    symlinkSync(
      join(home, '.gemini/antigravity-cli/conversations'),
      join(alias, '.gemini/antigravity-cli/brain'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => importAgyTranscript(home, thread, checkpoint, store, images, {}, alias), /Unverified/);
    assert.equal(store.messages().length, 2);
    assert.equal(readdirSync(join(home, 'images')).filter((name) => name.endsWith('.bin')).length, 1);
  } finally {
    state.close();
  }
});

test('legacy checkpoint recovery requires a complete local prefix and rejects ambiguous or partial histories', () => {
  const state = setup();
  try {
    const local = [
      { id: '11111111-1111-4111-8111-111111111111', role: 'user', text: 'Hello', status: 'complete', created: 1 },
      { id: '22222222-2222-4222-8222-222222222222', role: 'assistant', text: 'Hi', status: 'complete', created: 2 },
    ];
    state.write([user('Hello'), assistant('Hi')]);
    const expected = captureAgyTranscript(state.home, thread);
    state.write([user('Hello'), assistant('Hi'), user('Browser'), assistant('Reply')]);
    assert.deepEqual(recoverAgyTranscriptCheckpoint(state.home, thread, local), expected);
    assert.deepEqual(
      recoverAgyTranscriptCheckpoint(state.home, thread, [local[0], { ...local[1], text: 'Hi\n' }]),
      expected,
    );
    assert.throws(() => recoverAgyTranscriptCheckpoint(state.home, thread, []), /complete/);
    assert.throws(
      () =>
        recoverAgyTranscriptCheckpoint(
          state.home,
          thread,
          Array.from({ length: 200 }, (_, i) => local[i % 2]),
        ),
      /complete/,
    );
    assert.throws(
      () => recoverAgyTranscriptCheckpoint(state.home, thread, [{ ...local[0], text: 'Other' }, local[1]]),
      /match/,
    );
    assert.throws(
      () => recoverAgyTranscriptCheckpoint(state.home, thread, [local[0], { ...local[1], status: 'interrupted' }]),
      /complete/,
    );
    assert.throws(
      () => recoverAgyTranscriptCheckpoint(state.home, thread, [{ ...local[0], id: 'agy:imported:0' }, local[1]]),
      /complete/,
    );
    state.write([user('Earlier missing'), assistant('Earlier answer'), user('Hello'), assistant('Hi')]);
    assert.throws(() => recoverAgyTranscriptCheckpoint(state.home, thread, local), /match/);
  } finally {
    state.close();
  }
});
