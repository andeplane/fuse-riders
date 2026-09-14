import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaBacking } from '../src/client/phaser/viewport.js';

test('arena backing follows displayed size and screen density without changing world aspect', () => {
  assert.deepEqual(arenaBacking(1600, 900, 800, 450, 1), { width: 800, height: 450 });
  assert.deepEqual(arenaBacking(1600, 900, 800, 450, 2), { width: 1600, height: 900 });
  assert.deepEqual(arenaBacking(1600, 900, 800, 450, 3), { width: 2400, height: 1350 });
  assert.deepEqual(arenaBacking(1600, 900, 1600, 900, 2), { width: 3200, height: 1800 });
  assert.deepEqual(arenaBacking(1600, 900, 844, 390, 2), { width: 1387, height: 780 });
  assert.deepEqual(arenaBacking(1600, 900, 390, 844, 3), { width: 1170, height: 658 });
  assert.deepEqual(arenaBacking(1600, 900, 800, 900, 2, true), { width: 3200, height: 1800 });
});

test('arena backing bounds oversized displays and survives hidden or unavailable density', () => {
  assert.deepEqual(arenaBacking(1600, 900, 3840, 2160, 2), { width: 3840, height: 2160 });
  assert.deepEqual(arenaBacking(5000, 500, 5000, 500, 3), { width: 4096, height: 410 });
  assert.deepEqual(arenaBacking(1600, 900, 0, 0, 1), { width: 1600, height: 900 });
  assert.deepEqual(arenaBacking(1600, 900, 800, 450, NaN), { width: 800, height: 450 });
});
