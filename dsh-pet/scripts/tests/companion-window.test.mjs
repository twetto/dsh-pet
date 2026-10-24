import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

test('GPT, Gemini and Claude windows use separate API paths and histories', async () => {
  const bundle = await rolldown({
    platform: 'node',
    input: fileURLToPath(new URL('../../src/companion/routes.ts', import.meta.url)),
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  const { companionRoute } = await import(
    'data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64')
  );
  function fakeSession(name) {
    const snapshot = { connected: false, busy: false, state: 'idle', notice: '', threadId: null, messages: [] };
    return {
      snapshot: () => snapshot,
      async connect() {
        snapshot.connected = true;
      },
      async send(text, id) {
        snapshot.threadId = 'saved-' + name;
        snapshot.connected = true;
        snapshot.busy = true;
        snapshot.messages.push({ role: 'user', text, id, status: 'complete' });
        snapshot.messages.push({ role: 'assistant', text: 'Hello from ' + name, status: 'streaming' });
      },
      async stop() {
        snapshot.busy = false;
        snapshot.messages.at(-1).status = 'interrupted';
      },
      async startRemoteControl() {
        const url = 'https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc-v2';
        snapshot.remoteControl = { status: 'active', url };
        snapshot.connected = false;
        return url;
      },
      async returnFromRemoteControl() {
        snapshot.remoteControl = null;
        snapshot.connected = true;
        snapshot.notice = 'External messages are not mirrored here.';
      },
    };
  }
  const gpt = fakeSession('GPT');
  const gemini = fakeSession('Gemini');
  const claude = fakeSession('Claude');
  const routes = [companionRoute(gemini, 'agy'), companionRoute(claude, 'claude'), companionRoute(gpt)];
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const route = routes.find((candidate) => request.url.startsWith(candidate.path));
    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }
    void route.handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page
      .context()
      .route('https://antigravity.google.com/**', (route) => route.fulfill({ body: 'Remote Control test' }));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/companion/gemini/`);
    await page.getByRole('heading', { name: 'Gemini', exact: true }).waitFor();
    await page
      .getByText('Direct image attachments are unavailable here. Use Upload images in browser instead.', {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator('#image-tools').isVisible(), false);
    await page.getByText('Say hello. We can pick up here next time.').waitFor();
    await page.getByLabel('Talk to her').fill('<img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Hello from Gemini').waitFor();
    assert.equal(await page.locator('article img').count(), 0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByText('interrupted', { exact: true }).waitFor();
    await page.getByLabel('Talk to her').fill('Unsent draft');
    await page.getByRole('button', { name: 'Upload images in browser', exact: true }).click();
    await page.getByRole('link', { name: 'Open Remote Control', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Talk to her').inputValue(), 'Unsent draft');
    await page.getByRole('button', { name: 'Return to chat', exact: true }).click();
    await page.getByText('External messages are not mirrored here.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false);
    assert.equal(gemini.snapshot().threadId, 'saved-Gemini');
    assert.equal(gemini.snapshot().messages.length, 2);
    assert.equal(gpt.snapshot().messages.length, 0);
    assert.ok(requests.every((path) => path.startsWith('/companion/gemini/') || path === '/favicon.ico'));
    await page.goto(`http://127.0.0.1:${server.address().port}/companion/claude/`);
    await page.getByRole('heading', { name: 'Claude', exact: true }).waitFor();
    assert.equal(await page.locator('#remote-tools').isVisible(), false);
    await page.getByText('Say hello. We can pick up here next time.').waitFor();
    await page.getByLabel('Talk to her').fill('Hello Claude');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Hello from Claude').waitFor();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByText('interrupted', { exact: true }).waitFor();
    assert.equal(gemini.snapshot().messages.length, 2);
    assert.equal(gpt.snapshot().messages.length, 0);
    await page.goto(`http://127.0.0.1:${server.address().port}/companion/`);
    await page.getByRole('heading', { name: 'GPT girl', exact: true }).waitFor();
    assert.equal(await page.locator('#remote-tools').isVisible(), false);
    await page.getByText('Say hello. We can pick up here next time.').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
