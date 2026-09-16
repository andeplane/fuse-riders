import test from 'node:test';
import assert from 'node:assert/strict';
import { gunVelocity, cutTrailHole, GUN_SPEED, GUN_TURN_PER_TICK } from '../src/shared/gun.js';
import { RIDER_SPEED } from '../src/shared/game.js';
const trail = { x1: 0, y1: 0, x2: 200, y2: 0, createdTick: 12, expiresAtTick: 90 };
test('gun speed is three times rider speed with a bounded nearby steering correction', () => {
  assert.equal(GUN_SPEED, RIDER_SPEED * 3);
  const v = gunVelocity(0, 0, GUN_SPEED, 0, [{ x: 100, y: 100 }]);
  assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - GUN_SPEED) < 1e-9);
  assert.ok(Math.abs(Math.atan2(v.vy, v.vx) - GUN_TURN_PER_TICK) < 1e-9);
  for (const target of [{ x: 500, y: 100 }, { x: -100, y: 20 }]) assert.deepEqual(gunVelocity(0, 0, GUN_SPEED, 0, [target]), { vx: GUN_SPEED, vy: 0 });
});
test('gun holes split trails precisely, keeping expiry metadata and distant trails', () => {
  assert.deepEqual(cutTrailHole(trail, 100, 0, 50), [{ ...trail, x2: 50 }, { ...trail, x1: 150 }]);
  assert.deepEqual(cutTrailHole(trail, 100, 100, 50), [trail]);
  assert.deepEqual(cutTrailHole(trail, 100, 0, 300), []);
  assert.deepEqual(cutTrailHole({ ...trail, x2: 0 }, 0, 0, 50), []);
  assert.deepEqual(cutTrailHole(trail, 0, 0, 50), [{ ...trail, x1: 50 }]);
});
