import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import catalog from '../../runtime/avatar/catalog.cjs';

const root = resolve(import.meta.dirname, '../..');
const binary =
  process.env.DSH_PET_ELECTRON_PATH ||
  join(
    process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME, '.dsh'),
    'electron',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );

test('avatar catalog keeps accepted clips, provider isolation and on-screen geometry', () => {
  for (const [id, avatar] of Object.entries(catalog.avatars)) {
    assert.equal(existsSync(catalog.clipPath(id)), true);
    assert.equal(catalog.windowSize(id).height, 244);
    assert.equal(catalog.windowSize(id).width, Math.round((220 * avatar.width) / avatar.height) + 24);
  }
  assert.equal(catalog.avatars[catalog.avatarId('gpt')].provider, 'codex');
  assert.equal(catalog.avatars[catalog.avatarId('gemini')].provider, 'agy');
  assert.equal(catalog.avatars[catalog.avatarId('claude')].provider, 'claude');
  for (const id of ['../gpt', 'constructor', 'unknown']) assert.throws(() => catalog.avatarId(id));
  assert.deepEqual(
    catalog.confine({ x: -5000, y: 9999, width: 250, height: 244 }, { x: -1920, y: 0, width: 1920, height: 1080 }),
    { x: -1920, y: 836, width: 250, height: 244 },
  );
});

test(
  'Windows Electron renders all three transparent animated avatars with isolated IPC and hit testing',
  { timeout: 60000 },
  async (context) => {
    if (process.platform !== 'win32' || !existsSync(binary)) {
      context.skip('Windows Electron required');
      return;
    }
    const home = mkdtempSync(join(tmpdir(), 'pet-avatar-qa-'));
    const env = { ...process.env, DSH_HOME: home };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: binary,
      args: [join(root, 'runtime/avatar'), '--avatar=gpt'],
      env,
      timeout: 25000,
    });
    try {
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const [id, avatar] of Object.entries(catalog.avatars)) {
        await app.evaluate(({ app }, id) => app.emit('second-instance', {}, ['electron', '--avatar=' + id]), id);
        await page.waitForFunction(
          (id) => document.body.dataset.avatar === id && document.body.dataset.ready === 'true',
          id,
        );
        assert.deepEqual(
          await page.evaluate(() => ({
            width: document.querySelector('img').naturalWidth,
            height: document.querySelector('img').naturalHeight,
          })),
          { width: avatar.width, height: avatar.height },
        );
        const properties = await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          return {
            background: w.getBackgroundColor(),
            top: w.isAlwaysOnTop(),
            options: w.webContents.getLastWebPreferences(),
            bounds: w.getBounds(),
          };
        });

        assert.equal(properties.top, true);
        assert.equal(properties.options.nodeIntegration, false);
        assert.equal(properties.options.contextIsolation, true);
        assert.equal(properties.options.sandbox, true);
        assert.ok(
          Math.abs(properties.bounds.width - catalog.windowSize(id).width) <= 1,
          'DIP size within one physical-pixel rounding',
        );
        assert.ok(Math.abs(properties.bounds.height - catalog.windowSize(id).height) <= 1);
        assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
        const first = await page.screenshot({ omitBackground: true });
        await page.waitForTimeout(700);
        const second = await page.screenshot({ omitBackground: true });
        mkdirSync(join(root, 'lib/avatar-qa'), { recursive: true });
        writeFileSync(join(root, 'lib/avatar-qa', id + '.png'), second);
        assert.notEqual(
          createHash('sha256').update(first).digest('hex'),
          createHash('sha256').update(second).digest('hex'),
          id + ' must animate',
        );
        const pixels = await app.evaluate(({ nativeImage }, base64) => {
          const bitmap = nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).toBitmap();
          let transparent = 0,
            opaque = 0;
          for (let i = 3; i < bitmap.length; i += 4) {
            if (bitmap[i] === 0) transparent++;
            if (bitmap[i] > 240) opaque++;
          }
          return { corner: bitmap[3], transparent, opaque };
        }, second.toString('base64'));
        assert.equal(pixels.corner, 0);
        assert.ok(pixels.transparent > 1000 && pixels.opaque > 1000);
        const point = await page.evaluate(() => {
          const image = document.querySelector('img');
          const rect = image.getBoundingClientRect();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const y = Math.floor(canvas.height * 0.55);
          for (let x = Math.floor(canvas.width / 2); x < canvas.width; x++)
            if (pixels[(y * canvas.width + x) * 4 + 3] > 240)
              return { x: rect.x + (x * rect.width) / canvas.width, y: rect.y + (y * rect.height) / canvas.height };
        });
        assert.ok(point);
        await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          const original = w.setIgnoreMouseEvents.bind(w);
          w.setIgnoreMouseEvents = (value, options) => {
            w.avatarTestIgnored = value;
            return original(value, options);
          };
        });
        await app.evaluate(({ BrowserWindow, screen }, point) => {
          const bounds = BrowserWindow.getAllWindows()[0].getBounds();
          screen.getCursorScreenPoint = () => ({
            x: Math.round(bounds.x + point.x),
            y: Math.round(bounds.y + point.y),
          });
        }, point);
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(100);
        assert.equal(
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].avatarTestIgnored),
          false,
        );
        const beforeDrag = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        await page.mouse.down();
        await page.waitForFunction(() => document.body.classList.contains('dragging'));
        await page.waitForTimeout(50);
        await app.evaluate(
          ({ screen }, point) => {
            screen.getCursorScreenPoint = () => point;
          },
          {
            x: Math.round(beforeDrag.x + point.x - 60),
            y: Math.round(beforeDrag.y + point.y - 40),
          },
        );
        // Keep the native drag ticker running long enough to catch cumulative DPI growth.
        await page.waitForTimeout(1200);
        const afterDrag = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        assert.ok(Math.abs(afterDrag.x - beforeDrag.x + 60) <= 1, 'drag moves window horizontally');
        assert.ok(Math.abs(afterDrag.y - beforeDrag.y + 40) <= 1, 'drag moves window vertically');
        assert.ok(Math.abs(afterDrag.width - beforeDrag.width) <= 1, 'drag must not grow the window width');
        assert.ok(Math.abs(afterDrag.height - beforeDrag.height) <= 1, 'drag must not grow the window height');
        await page.mouse.up();
        await page.waitForFunction(() => !document.body.classList.contains('dragging'));
        await app.evaluate(({ BrowserWindow, screen }) => {
          const bounds = BrowserWindow.getAllWindows()[0].getBounds();
          screen.getCursorScreenPoint = () => ({ x: bounds.x + 2, y: bounds.y + 2 });
        });
        await page.mouse.move(2, 2);
        await page.waitForTimeout(100);
        assert.equal(
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].avatarTestIgnored),
          true,
        );
      }
      assert.deepEqual(errors, []);
      await assert.rejects(
        page.evaluate(() => fetch('https://example.com')),
        /Failed to fetch/,
      );
    } finally {
      await app.close();
    }
  },
);

test(
  'each avatar launches only its matching companion and keeps capabilities out of the renderer',
  { timeout: 45000 },
  async (context) => {
    if (process.platform !== 'win32' || !existsSync(binary)) {
      context.skip('Windows Electron required');
      return;
    }
    const home = mkdtempSync(join(tmpdir(), 'pet-avatar-chat-qa-'));
    const token = randomBytes(32).toString('base64url');
    let healthChecks = 0;
    const server = createServer((request, response) => {
      if (request.url === '/health') {
        assert.equal(request.headers['x-dsh-pet-token'], undefined);
        healthChecks++;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ name: 'dsh-pet-standalone', pid: process.pid }));
      } else {
        assert.ok(['/companion/', '/companion/gemini/', '/companion/claude/'].includes(request.url));
        assert.equal(request.headers['x-dsh-pet-token'], token);
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><html><body>Companion visibility test</body></html>');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    mkdirSync(join(home, 'dsh-pet'));
    writeFileSync(
      join(home, 'dsh-pet/standalone-runtime.json'),
      JSON.stringify({
        port: server.address().port,
        pid: process.pid,
        token,
        companion: true,
        geminiCompanion: true,
        claudeCompanion: true,
      }),
    );
    const chatBootstrap = join(home, 'chat-bootstrap.cjs');
    writeFileSync(
      chatBootstrap,
      `
      const { app } = require('electron');
      const { join } = require('node:path');
      app.setPath('userData', join(${JSON.stringify(home)}, 'chat-electron', process.env.DSH_PET_CHAT_PROVIDER));
      require(${JSON.stringify(join(root, 'runtime/companion/main.cjs'))});
    `,
    );
    const bootstrap = join(home, 'bootstrap.cjs');
    writeFileSync(
      bootstrap,
      `
    const cp = require('node:child_process');
    const { Menu } = require('electron');
    const spawn = cp.spawn;
    const build = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = (template) => {
      const menu = build(template);
      globalThis.avatarTestMenu = menu;
      return menu;
    };
    globalThis.avatarTestChildPids = [];
    cp.spawn = (executable, args, options) => {
      const child = spawn(executable, [${JSON.stringify(chatBootstrap)}], options);
      globalThis.avatarTestChildPids.push(child.pid);
      globalThis.avatarTestLaunch = { executable, target: args[0], provider: options.env.DSH_PET_CHAT_PROVIDER,
        tokenMatches: options.env.DSH_PET_CHAT_TOKEN === ${JSON.stringify(token)},
        nodeMode: Object.hasOwn(options.env, 'ELECTRON_RUN_AS_NODE'), hidden: options.windowsHide, pid: child.pid };
      return child;
    };
    require(${JSON.stringify(join(root, 'runtime/avatar/main.cjs'))});
  `,
    );
    const env = { ...process.env, DSH_HOME: home };
    delete env.ELECTRON_RUN_AS_NODE;
    let app;
    try {
      app = await electron.launch({ executablePath: binary, args: [bootstrap, '--avatar=gpt'], env, timeout: 15000 });
      const page = await app.firstWindow();
      for (const [id, avatar] of Object.entries(catalog.avatars)) {
        await app.evaluate(({ app }, id) => app.emit('second-instance', {}, ['electron', '--avatar=' + id]), id);
        await page.waitForFunction(
          (id) => document.body.dataset.avatar === id && document.body.dataset.ready === 'true',
          id,
        );
        const visible = await page.evaluate(() => window.avatarBridge.configuration());
        assert.equal(Object.hasOwn(visible, 'token'), false);
        if (avatar.provider === 'codex') {
          const point = await page.evaluate(() => {
            const rect = document.querySelector('img').getBoundingClientRect();
            return { x: rect.x + rect.width * 0.5, y: rect.y + rect.height * 0.55 };
          });
          await app.evaluate(({ screen, BrowserWindow }, point) => {
            const bounds = BrowserWindow.getAllWindows()[0].getBounds();
            screen.getCursorScreenPoint = () => ({
              x: Math.round(bounds.x + point.x),
              y: Math.round(bounds.y + point.y),
            });
          }, point);
          await page.mouse.dblclick(point.x, point.y, { delay: 80 });
        } else {
          await page.evaluate(() =>
            window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
          );
          await page.waitForTimeout(50);
          await app.evaluate(() => {
            const menu = globalThis.avatarTestMenu;
            menu.closePopup();
            menu.items.find((item) => item.label === '開啟聊天室').click();
          });
        }
        let result;
        for (let attempt = 0; attempt < 100; attempt++) {
          result = await app.evaluate(() => globalThis.avatarTestLaunch);
          if (result?.provider === avatar.provider) break;
          await page.waitForTimeout(20);
        }
        assert.equal(result?.provider, avatar.provider);
        assert.equal(result.tokenMatches, true);
        assert.equal(result.nodeMode, false);
        assert.equal(result.hidden, false);
        assert.equal(result.target, join(root, 'runtime/companion'));
        const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
        const { stdout } = await promisify(execFile)(
          ps,
          [
            '-NoProfile',
            '-Command',
            `$visible=$false; for ($i=0; $i -lt 100; $i++) { $p=Get-Process -Id ${result.pid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { $visible=$true; break }; Start-Sleep -Milliseconds 50 }; $visible`,
          ],
          { windowsHide: true },
        );
        assert.equal(stdout.trim(), 'True', avatar.provider + ' companion must have a visible native window');
      }
      assert.equal(healthChecks, 3);
    } finally {
      if (app) {
        const pids = await app.evaluate(() => globalThis.avatarTestChildPids || []).catch(() => []);
        for (const pid of pids)
          await promisify(execFile)('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(
            () => {},
          );
        await app.close();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  'three avatars coexist under one home and all reuses them without replacing other windows',
  { timeout: 45000 },
  async (context) => {
    if (process.platform !== 'win32' || !existsSync(binary)) {
      context.skip('Windows Electron required');
      return;
    }
    const home = mkdtempSync(join(tmpdir(), 'pet-avatar-three-'));
    const env = { ...process.env, DSH_HOME: home, DSH_PET_ELECTRON_PATH: binary };
    delete env.ELECTRON_RUN_AS_NODE;
    const applications = [];
    try {
      for (const id of Object.keys(catalog.avatars)) {
        const app = await electron.launch({
          executablePath: binary,
          args: [join(root, 'runtime/avatar'), '--avatar=' + id],
          env,
          timeout: 15000,
        });
        applications.push(app);
        const page = await app.firstWindow();
        await page.waitForFunction(
          (id) => document.body.dataset.avatar === id && document.body.dataset.ready === 'true',
          id,
        );
      }
      const bounds = await Promise.all(
        applications.map((app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())),
      );
      assert.equal(new Set(bounds.map((b) => b.x)).size, 3, 'initial positions differ');
      await promisify(execFile)(process.execPath, [join(root, 'scripts/start-avatar.mjs'), 'all'], {
        env,
        cwd: root,
        windowsHide: true,
        timeout: 15000,
      });
      for (const [index, app] of applications.entries()) {
        assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        assert.equal(
          await (await app.firstWindow()).evaluate(() => document.body.dataset.avatar),
          Object.keys(catalog.avatars)[index],
        );
      }
      await applications[0].close();
      applications.shift();
      for (const app of applications)
        assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    } finally {
      for (const app of applications) await app.close().catch(() => {});
    }
  },
);
