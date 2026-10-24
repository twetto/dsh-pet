import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

for (const provider of ['claude', 'codex'])
  test(`${provider} supports image drop, paste, removal, path attachments, image-only sends and restart thumbnails`, async () => {
    const routesPath = fileURLToPath(new URL('../../src/companion/routes.ts', import.meta.url));
    const sessionPath = fileURLToPath(new URL('../../src/companion/claude-session.ts', import.meta.url));
    const codexPath = fileURLToPath(new URL('../../src/companion/session.ts', import.meta.url));
    const protocolPath = fileURLToPath(new URL('../../src/companion/protocol.ts', import.meta.url));
    const serverPath = fileURLToPath(new URL('../../src/standalone/server.ts', import.meta.url));
    const fixture = fileURLToPath(new URL('./claude-protocol-fixture.mjs', import.meta.url));
    const imageSource = readFileSync(new URL('../../src/companion/images.test.ts', import.meta.url), 'utf8');
    const imageData = imageSource.match(/export const redPng\s*=\s*'([^']+)'/)[1];
    const bundle = await rolldown({
      platform: 'node',
      input: 'virtual:companion-image-test',
      plugins: [
        {
          name: 'test-entry',
          resolveId(id) {
            if (id === 'virtual:companion-image-test') return id;
          },
          load(id) {
            if (id === 'virtual:companion-image-test')
              return `export {companionRoute} from ${JSON.stringify(routesPath)};export {ClaudeSession} from ${JSON.stringify(sessionPath)};export {CompanionSession} from ${JSON.stringify(codexPath)};export {CodexProtocol} from ${JSON.stringify(protocolPath)};export {createRequestListener} from ${JSON.stringify(serverPath)};`;
          },
        },
      ],
    });
    const { output } = await bundle.generate({ format: 'esm' });
    await bundle.close();
    const { companionRoute, ClaudeSession, CompanionSession, CodexProtocol, createRequestListener } = await import(
      'data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64')
    );
    const directory = mkdtempSync(join(tmpdir(), 'pet-image-browser-'));
    class FakeCodex extends CodexProtocol {
      async connect() {}
      async request(method, params) {
        if (method.startsWith('thread/')) return { thread: { id: 'image-browser-thread' } };
        assert.equal(method, 'turn/start');
        assert.equal(params.input.filter((item) => item.type === 'image').length, 2);
        for (const item of params.input.filter((item) => item.type === 'image'))
          assert.equal(item.url, 'data:image/png;base64,' + imageData);
        setTimeout(10).then(() => {
          this.onNotification('item/completed', {
            threadId: 'image-browser-thread',
            item: { type: 'agentMessage', id: 'answer', text: 'Image received' },
          });
          this.onNotification('turn/completed', {
            threadId: 'image-browser-thread',
            turn: { id: 'turn', status: 'completed' },
          });
        });
        return { turn: { id: 'turn' } };
      }
      close() {}
    }
    const create = () =>
      provider === 'claude'
        ? new ClaudeSession(join(directory, 'chat'), () => {}, process.execPath, [fixture])
        : new CompanionSession(join(directory, 'chat'), () => {}, new FakeCodex());
    const base = provider === 'claude' ? '/companion/claude' : '/companion';
    let session = create();
    const routes = [companionRoute(session, provider)];
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const server = createServer(createRequestListener({ routes, logger }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}${base}/`);
      await page.getByText('Drop images here or paste with Ctrl+V', { exact: false }).waitFor();
      await page.waitForFunction(() => !document.getElementById('send').disabled);
      assert.equal(await page.locator('input[type=file]').count(), 0);
      async function transfer(kind, name) {
        await page.evaluate(
          ({ kind, name, data }) => {
            const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
            const transfer = new DataTransfer();
            transfer.items.add(new File([bytes], name, { type: 'image/png' }));
            const event =
              kind === 'drop'
                ? new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
                : new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
            document.dispatchEvent(event);
          },
          { kind, name, data: imageData },
        );
      }
      await transfer('drop', 'dropped.png');
      await page.getByRole('img', { name: 'dropped.png', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('#attachments img')?.naturalWidth === 16);
      await page.locator('#attachments img').evaluate((image) => image.decode());
      await page.getByRole('button', { name: 'Remove dropped.png', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#attachments img').length === 0);
      assert.equal(readdirSync(join(directory, 'chat/images')).filter((name) => name.endsWith('.bin')).length, 0);
      await transfer('paste', 'pasted.png');
      await page.getByRole('img', { name: 'pasted.png', exact: true }).waitFor();
      const path = join(directory, 'path-image.png');
      writeFileSync(path, Buffer.from(imageData, 'base64'));
      await page.getByText('Attach an image path', { exact: true }).click();
      await page.getByLabel('Absolute image path').fill(path);
      await page.getByRole('button', { name: 'Attach', exact: true }).click();
      await page.getByRole('img', { name: 'path-image.png', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('Image received', { exact: true }).waitFor();
      assert.equal(await page.locator('#attachments img').count(), 0);
      for (let attempt = 0; attempt < 200 && session.snapshot().busy; attempt++) await setTimeout(10);
      assert.equal(session.snapshot().messages[0].images.length, 2);
      await session.close();
      session = create();
      routes[0] = companionRoute(session, provider);
      await page.reload();
      await page.getByText('Image received', { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('article img')].length === 2 &&
          [...document.querySelectorAll('article img')].every((image) => image.complete && image.naturalWidth === 16),
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await session.close();
      await new Promise((resolve) => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  });
