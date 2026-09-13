import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRUNK_DURATION_TICKS, DRUNK_KNOT_INTERVAL_TICKS, DRUNK_MAX_ANGULAR_VELOCITY,
  drunkAngularVelocity,
} from '../src/shared/drunk.ts';

test('uses the accepted duration, interval, and bound', () => {
  assert.equal(DRUNK_DURATION_TICKS, 80);
  assert.equal(DRUNK_KNOT_INTERVAL_TICKS, 10);
  assert.equal(DRUNK_MAX_ANGULAR_VELOCITY, 2);
  for (let tick = 0; tick < 500; tick += 1) {
    assert.ok(Math.abs(drunkAngularVelocity(42, 'p1', tick)) <= DRUNK_MAX_ANGULAR_VELOCITY);
  }
});

test('is deterministic, smooth between knots, and independent per player', () => {
  const first = Array.from({ length: 80 }, (_, tick) => drunkAngularVelocity(123, 'alice', tick));
  assert.deepEqual(first, Array.from({ length: 80 }, (_, tick) => drunkAngularVelocity(123, 'alice', tick)));
  assert.notDeepEqual(first, Array.from({ length: 80 }, (_, tick) => drunkAngularVelocity(123, 'bob', tick)));
  for (let tick = 1; tick < first.length; tick += 1) assert.ok(Math.abs(first[tick]! - first[tick - 1]!) <= 0.5);
});

test('changes with seed and does not mutate inputs', () => {
  const id = 'player-ø';
  const before = id.slice();
  assert.notEqual(drunkAngularVelocity(1, id, 17), drunkAngularVelocity(2, id, 17));
  assert.equal(id, before);
});
