import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const policy = runInNewContext(
  `${readFileSync(new URL('../../runtime/quickshell/avatar.js', import.meta.url), 'utf8')}; ({ validAvatar, animationFor });`,
);

test('only the two supported avatars are selectable', () => {
  for (const name of ['deepseek', 'gpt-girl']) assert.equal(policy.validAvatar(name), true);
  for (const name of ['', 'unknown', '../idle', null]) assert.equal(policy.validAvatar(name), false);
});

test('GPT falls back to idle without changing DeepSeek state/action choices', () => {
  for (const state of [
    'idle',
    'thinking',
    'working',
    'result',
    'waiting',
    'success',
    'error',
    'drag',
    'click',
    '吃白饭',
  ]) {
    assert.equal(policy.animationFor('gpt-girl', state), 'idle');
    assert.equal(policy.animationFor('deepseek', state), state);
  }
});
