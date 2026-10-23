import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { actionCatalog, animationSource, coreClips } from '../../runtime/quickshell/catalog.mjs';

test('every bundled WebM has a unique selectable action and existing source', () => {
  const actions = actionCatalog();
  const files = readdirSync(new URL('../../assets/webm/', import.meta.url)).filter((file) => file.endsWith('.webm'));
  assert.equal(actions.length, files.length);
  assert.equal(new Set(actions.map((action) => action.clip)).size, actions.length);
  for (const action of actions) assert.ok(existsSync(animationSource(action.clip)), action.label);
  for (const [clip, label] of Object.entries(coreClips))
    assert.ok(actions.some((action) => action.clip === clip && action.label === label));
});

test('unknown actions and path traversal cannot select a source', () => {
  for (const name of ['../idle', '/tmp/test', 'unknown', '']) assert.throws(() => animationSource(name));
});
