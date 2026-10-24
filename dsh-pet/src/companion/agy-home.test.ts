import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareAgyHome } from './agy-home';
import { checkAgyCustomizations, AgySession } from './agy-session';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const fixture = fileURLToPath(new URL('../../scripts/tests/agy-protocol-fixture.mjs', import.meta.url));

test('isolated agy home excludes global customizations without copying credentials or losing native data', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-agy-home-'));
  const original = join(root, 'original');
  const isolated = join(root, 'isolated');
  const plugin = join(original, '.gemini/config/plugins/science');
  const native = join(original, '.gemini/antigravity-cli');
  mkdirSync(plugin, { recursive: true });
  mkdirSync(join(native, 'brain'), { recursive: true });
  writeFileSync(join(plugin, 'plugin.json'), '{"name":"science"}');
  writeFileSync(join(native, 'settings.json'), '{"permissions":{"allow":["command(*)"]}}');
  writeFileSync(join(original, '.gemini/oauth_creds.json'), 'private-fixture');
  writeFileSync(join(native, 'brain/existing-thread'), 'native history');
  mkdirSync(join(native, 'cache'));
  writeFileSync(
    join(native, 'cache/onboarding.json'),
    JSON.stringify({
      onboardingComplete: true,
      consumerOnboardingComplete: true,
      enterpriseOnboardingComplete: false,
      unrelatedPrivateValue: 'must-not-copy',
    }),
  );
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  try {
    assert.throws(() => checkAgyCustomizations(original), /plugins/);
    const env = prepareAgyHome(isolated, original);
    checkAgyCustomizations(isolated);
    assert.deepEqual(
      JSON.parse(readFileSync(join(isolated, '.gemini/antigravity-cli/cache/onboarding.json'), 'utf8')),
      {
        onboardingComplete: true,
        consumerOnboardingComplete: true,
        enterpriseOnboardingComplete: false,
      },
    );
    assert.equal(env.HOME, isolated);
    assert.equal(env.USERPROFILE, isolated);
    assert.deepEqual({ HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }, previous);
    assert.equal(readFileSync(join(plugin, 'plugin.json'), 'utf8'), '{"name":"science"}');
    assert.equal(readFileSync(join(native, 'settings.json'), 'utf8'), '{"permissions":{"allow":["command(*)"]}}');
    assert.throws(() => readFileSync(join(isolated, '.gemini/oauth_creds.json')), /ENOENT/);
    assert.throws(() => readFileSync(join(isolated, '.gemini/antigravity-cli/settings.json')), /ENOENT/);
    assert.equal(
      readFileSync(join(isolated, '.gemini/antigravity-cli/brain/existing-thread'), 'utf8'),
      'native history',
    );
    prepareAgyHome(isolated, original);
    assert.equal(
      realpathSync(join(isolated, '.gemini/antigravity-cli/conversations')),
      realpathSync(join(native, 'conversations')),
    );
    mkdirSync(join(isolated, '.gemini/config/plugins/unexpected'), { recursive: true });
    assert.throws(() => checkAgyCustomizations(isolated), /plugins/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agy rejects a pre-existing native-data directory instead of replacing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-agy-home-'));
  try {
    mkdirSync(join(root, 'original'));
    mkdirSync(join(root, 'isolated/.gemini/antigravity-cli/brain'), { recursive: true });
    assert.throws(() => prepareAgyHome(join(root, 'isolated'), join(root, 'original')), /Unexpected/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('global plugins coexist with chat and Remote Control using the same child-only home', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-agy-isolated-session-'));
  const plugin = join(root, '.gemini/config/plugins/science');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'plugin.json'), '{}');
  const isolated = join(root, 'chat/agy-home');
  const previous = process.env.PET_TEST_AGY_EXPECT_HOME;
  process.env.PET_TEST_AGY_EXPECT_HOME = isolated;
  let remoteStarted = false;
  const session = new AgySession(
    join(root, 'chat'),
    () => {},
    process.execPath,
    [fixture],
    root,
    () => ({
      async start(_executable, _args, _cwd, env) {
        assert.equal(env?.HOME, isolated);
        assert.equal(env?.USERPROFILE, isolated);
        remoteStarted = true;
        return 'https://antigravity.google.com/r/12345678-1234-4234-8234-123456789abc-v2';
      },
      async close() {},
    }),
  );
  try {
    await session.send('hello', randomUUID());
    for (let i = 0; i < 200 && session.snapshot().busy; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(session.snapshot().messages[1]?.text, 'Hello Gemini');
    await session.startRemoteControl();
    assert.equal(remoteStarted, true);
    assert.equal(readFileSync(join(plugin, 'plugin.json'), 'utf8'), '{}');
  } finally {
    await session.close();
    if (previous === undefined) delete process.env.PET_TEST_AGY_EXPECT_HOME;
    else process.env.PET_TEST_AGY_EXPECT_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('incomplete normal onboarding is never promoted to completion', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-agy-onboarding-'));
  try {
    const native = join(root, 'original/.gemini/antigravity-cli/cache');
    mkdirSync(native, { recursive: true });
    writeFileSync(
      join(native, 'onboarding.json'),
      JSON.stringify({ onboardingComplete: false, consumerOnboardingComplete: true }),
    );
    const isolated = join(root, 'isolated');
    prepareAgyHome(isolated, join(root, 'original'));
    assert.throws(() => readFileSync(join(isolated, '.gemini/antigravity-cli/cache/onboarding.json')), /ENOENT/);
    assert.equal(JSON.parse(readFileSync(join(native, 'onboarding.json'), 'utf8')).onboardingComplete, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
