import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { clickResponses } from '../../runtime/quickshell/catalog.mjs';

const pickResponse = runInNewContext(
  `${readFileSync(new URL('../../runtime/quickshell/click-response.js', import.meta.url), 'utf8')}; pickResponse;`,
);

test('all five click reactions are selectable and immediate repeats are excluded', () => {
  const clips = clickResponses();
  assert.equal(clips.length, 5);
  const selections = new Set(Array.from({ length: 5 }, (_, index) => pickResponse(clips, '', (index + 0.5) / 5)));
  assert.equal(selections.size, 5);
  for (const previous of clips) {
    for (const randomValue of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const selected = pickResponse(clips, previous, randomValue);
      assert.ok(clips.includes(selected));
      assert.notEqual(selected, previous);
    }
  }
});

test('empty and single-clip pools are safe', () => {
  assert.equal(pickResponse([], '', 0), '');
  assert.equal(pickResponse(['click'], 'click', 0), 'click');
});
