import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('idle pilot poses have the same RGBA PNG canvas', () => {
  const dimensions = [];
  for (const name of [
    'concept-v1.png',
    'idle-blink-v1.png',
    'idle-half-blink-v1.png',
    'idle-look-left-v1.png',
    'idle-look-right-v1.png',
  ]) {
    const png = readFileSync(new URL(`../../assets/gpt-girl/${name}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.subarray(12, 16).toString(), 'IHDR');
    assert.equal(png[25], 6, 'PNG must include an alpha channel');
    dimensions.push([png.readUInt32BE(16), png.readUInt32BE(20)]);
  }
  assert.equal(dimensions.length, 5);
  for (const size of dimensions) assert.deepEqual(size, [1312, 1199]);
});

test('breathing is continuous and exhalation is slower; blink pauses vary within bounds', () => {
  const motion = runInNewContext(
    `${readFileSync(new URL('../../runtime/quickshell/gpt-girl/motion.js', import.meta.url), 'utf8')}; ({ breathing, blinkDelay });`,
  );
  assert.equal(motion.breathing(0), 0);
  assert.equal(motion.breathing(1), 0);
  assert.equal(motion.breathing(0.38), 1);
  assert.ok(Math.abs(motion.breathing(0.19) - 0.5) < 1e-12);
  assert.ok(Math.abs(motion.breathing(0.69) - 0.5) < 1e-12);
  for (let index = -100; index <= 100; index++) {
    const breath = motion.breathing(index / 100);
    assert.ok(breath >= 0 && breath <= 1);
  }
  assert.equal(motion.blinkDelay(0), 2800);
  assert.equal(motion.blinkDelay(1), 6000);
});
