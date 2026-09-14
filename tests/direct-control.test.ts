import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUND_CONTROL_BYTES, isBoundControl } from '../src/online/direct-control.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';

test('compact control admits only complete bounded clock and finality schemas', () => {
  const valid: unknown[] = [[1, 7, 'clock', 1], [1, 7, 'time', 2, -20], [1, 7, 'time', 3, 72_000.125], [1, 7, 'final', 100, [], 'a'.repeat(16)],
    [1, 0xffffffff, 'final', 0xffffffff, [0, 1, 2, 3, 4].map(slot => [slot, 0xffffffff]), '0123456789abcdef']];
  for (const tuple of valid) {
    assert.equal(isBoundControl(tuple), true);
    const bytes = packMessage(tuple); assert.ok(bytes.byteLength < BOUND_CONTROL_BYTES);
    assert.equal(isBoundControl(unpackMessage(bytes)), true);
  }
  const invalid: unknown[] = [null, {}, [], [2, 7, 'clock', 1], [1, 0, 'clock', 1], [1, 7, 'unknown', 1], [1, 7, 'clock', 0], [1, 7, 'clock', 1, 2],
    [1, 7, 'time', 0, 100], [1, 7, 'time', 1, NaN], [1, 7, 'time', 1, Infinity], [1, 7, 'time', 1, -21], [1, 7, 'time', 1, 2 ** 32], [1, 7, 'time', 1],
    [1, 7, 'final', -1, [], 'a'.repeat(16)], [1, 7, 'final', 1, [], 'bad'], [1, 7, 'final', 1, null, 'a'.repeat(16)],
    [1, 7, 'final', 1, [[0, 1], [0, 2]], 'a'.repeat(16)], [1, 7, 'final', 1, [[5, 1]], 'a'.repeat(16)], [1, 7, 'final', 1, [[0, -1]], 'a'.repeat(16)],
    [1, 7, 'final', 1, [[0]], 'a'.repeat(16)], [1, 7, 'final', 1, [null], 'a'.repeat(16)], [1, 7, 'final', 1, Array(6).fill([0, 0]), 'a'.repeat(16)]];
  for (const tuple of invalid) assert.equal(isBoundControl(tuple), false, JSON.stringify(tuple));
});
