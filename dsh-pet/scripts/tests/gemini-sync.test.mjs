import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

test('Gemini return imports browser text and images once, preserves thumbnails after restart and rejects direct uploads', async () => {
  const routesPath = fileURLToPath(new URL('../../src/companion/routes.ts', import.meta.url));
  const sessionPath = fileURLToPath(new URL('../../src/companion/agy-session.ts', import.meta.url));
  const serverPath = fileURLToPath(new URL('../../src/standalone/server.ts', import.meta.url));
  const securityPath = fileURLToPath(new URL('../../src/standalone/request-security.ts', import.meta.url));
  const fixture = fileURLToPath(new URL('./agy-protocol-fixture.mjs', import.meta.url));
  const source = readFileSync(new URL('../../src/companion/images.test.ts', import.meta.url), 'utf8');
  const png = source.match(/export const redPng\s*=\s*'([^']+)'/)[1];
  const bundle = await rolldown({
    platform: 'node',
    external: ['node-pty'],
    input: 'virtual:gemini-sync',
    plugins: [
      {
        name: 'test-entry',
        resolveId(id) {
          if (id === 'virtual:gemini-sync') return id;
        },
        load(id) {
          if (id === 'virtual:gemini-sync')
            return `export {companionRoute} from ${JSON.stringify(routesPath)};export {AgySession} from ${JSON.stringify(sessionPath)};export {createRequestListener} from ${JSON.stringify(serverPath)};export {createRequestSecurity} from ${JSON.stringify(securityPath)};`;
        },
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  const { companionRoute, AgySession, createRequestListener, createRequestSecurity } = await import(
    'data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64')
  );
  const home = mkdtempSync(join(tmpdir(), 'pet-gemini-sync-browser-'));
  const thread = '12345678-1234-4234-8234-123456789abc';
  const root = join(home, '.gemini/antigravity-cli/brain', thread);
  const log = join(root, '.system_generated/logs/transcript.jsonl');
  const media = join(root, '.user_uploaded/red.png');
  mkdirSync(join(root, '.system_generated/logs'), { recursive: true });
  mkdirSync(join(root, '.user_uploaded'));
  const rows = [];
  const append = (source, type, content, extra = {}) =>
    rows.push({
      step_index: rows.length,
      source,
      type,
      content,
      status: 'DONE',
      created_at: '2026-10-24T10:19:41Z',
      ...extra,
    });
  const user = (text) =>
    '<USER_REQUEST>\n' + text + '\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nPrivate metadata\n</ADDITIONAL_METADATA>';
  append('USER_EXPLICIT', 'USER_INPUT', user('hello'));
  append('MODEL', 'PLANNER_RESPONSE', 'Hello Gemini');
  const save = () => writeFileSync(log, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  save();
  const create = () =>
    new AgySession(
      join(home, 'ledger'),
      () => {},
      process.execPath,
      [fixture],
      home,
      (onExit) => ({
        async start(_executable, args) {
          assert.equal(args[args.indexOf('--conversation') + 1], thread);
          writeFileSync(media, Buffer.from(png, 'base64'));
          append('USER_EXPLICIT', 'USER_INPUT', user('What color is this?'), {
            media: [{ mime_type: 'image/png', uri: media }],
          });
          append('MODEL', 'PLANNER_RESPONSE', 'The image is red.');
          save();
          return 'https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc-v2?p=c%2F' + thread;
        },
        async close() {
          onExit();
        },
      }),
    );
  let session = create();
  const security = createRequestSecurity();
  const routes = [companionRoute(session, 'agy')];
  const server = createServer(
    createRequestListener({ routes, security, logger: { info() {}, warn() {}, error() {}, debug() {} } }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
  let browser;
  try {
    await session.send('hello', randomUUID());
    for (let attempt = 0; attempt < 200 && session.snapshot().busy; attempt++) await setTimeout(10);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page
      .context()
      .route(origin + '/**', async (route) =>
        route.continue({ headers: { ...route.request().headers(), 'X-DSH-Pet-Token': security.token } }),
      );
    await page
      .context()
      .route('https://antigravity.google.com/**', (route) => route.fulfill({ body: 'Remote Control test' }));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/companion/gemini/');
    await page.getByText('Hello Gemini', { exact: true }).waitFor();
    for (let pass = 1; pass <= 2; pass++) {
      await page.getByRole('button', { name: 'Upload images in browser', exact: true }).click();
      await page.getByRole('link', { name: 'Open Remote Control', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Return to chat', exact: true }).click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('article img').length === count &&
          [...document.querySelectorAll('article img')].every((image) => image.naturalWidth === 16),
        pass,
      );
      assert.equal(session.snapshot().messages.length, 2 + pass * 2);
      assert.equal(session.snapshot().threadId, thread);
      assert.match(session.snapshot().notice, /Synced 2/);
      const image = session.snapshot().messages.at(-2).images[0];
      assert.equal((await fetch(origin + '/companion/gemini/images/' + image.id)).status, 403);
      const preview = await fetch(origin + '/companion/gemini/images/' + image.id, { headers });
      assert.deepEqual(Buffer.from(await preview.arrayBuffer()), Buffer.from(png, 'base64'));
      assert.equal(
        (
          await fetch(origin + '/companion/gemini/images', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: 'blocked.png', data: png }),
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await fetch(origin + '/companion/gemini/message', {
            method: 'POST',
            headers,
            body: JSON.stringify({ text: 'blocked', id: randomUUID(), images: [image.id] }),
          })
        ).status,
        400,
      );
      rmSync(media);
      await session.close();
      session = create();
      routes[0] = companionRoute(session, 'agy');
      await page.reload();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('article img').length === count &&
          [...document.querySelectorAll('article img')].every((image) => image.naturalWidth === 16),
        pass,
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await session.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(home, { recursive: true, force: true });
  }
});
