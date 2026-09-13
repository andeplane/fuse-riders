import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOMB_MAX_CHARGE_TICKS,
  BOMB_MAX_LAUNCH_DISTANCE,
  BOMB_MIN_LAUNCH_DISTANCE,
  bombLandingPoint,
  bombLaunchDistance,
} from '../src/shared/bomb-launch.ts';

test('maps charge ticks linearly between accepted minimum and maximum', () => {
  assert.equal(bombLaunchDistance(0), BOMB_MIN_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(BOMB_MAX_CHARGE_TICKS / 2), 250);
  assert.equal(bombLaunchDistance(BOMB_MAX_CHARGE_TICKS), BOMB_MAX_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(999), BOMB_MAX_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(-2), BOMB_MIN_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(Number.NaN), BOMB_MIN_LAUNCH_DISTANCE);
});

test('projects along the release angle and clamps each coordinate to safe bounds', () => {
  const bounds = { left: 27, right: 1573, top: 27, bottom: 873 };
  assert.deepEqual(bombLandingPoint(100, 100, 0, 200, bounds), { x: 300, y: 100 });
  assert.deepEqual(bombLandingPoint(1550, 860, Math.PI / 4, 400, bounds), { x: 1573, y: 873 });
  assert.deepEqual(bombLandingPoint(40, 40, Math.PI * 1.25, 400, bounds), { x: 27, y: 27 });
});
