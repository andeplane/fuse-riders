import assert from "node:assert/strict";
import test from "node:test";
import {
  BOMB_MAX_CHARGE_TICKS,
  BOMB_MAX_LAUNCH_DISTANCE,
  BOMB_MIN_LAUNCH_DISTANCE,
  bombLandingPoint,
  bombLaunchDistance,
  isBombChargeTicks,
} from "../src/shared/bomb-launch.ts";

test("maps charge ticks linearly between accepted minimum and maximum", () => {
  assert.equal(bombLaunchDistance(0), BOMB_MIN_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(BOMB_MAX_CHARGE_TICKS / 2), 250);
  assert.equal(
    bombLaunchDistance(BOMB_MAX_CHARGE_TICKS),
    BOMB_MAX_LAUNCH_DISTANCE,
  );
  assert.equal(bombLaunchDistance(999), BOMB_MAX_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(-2), BOMB_MIN_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(Number.NaN), BOMB_MIN_LAUNCH_DISTANCE);
});

test("a custom aim time scales the same distance range and bounds the tick grid", () => {
  assert.equal(BOMB_MAX_CHARGE_TICKS, 8, "default aim time is 0.4 s at 20 Hz");
  assert.equal(bombLaunchDistance(12, 24), 250);
  assert.equal(bombLaunchDistance(24, 24), BOMB_MAX_LAUNCH_DISTANCE);
  assert.equal(bombLaunchDistance(1, 2), 250);
  assert.equal(bombLaunchDistance(60, 40), BOMB_MAX_LAUNCH_DISTANCE);
  for (const value of [2, 8, 40]) assert.equal(isBombChargeTicks(value), true);
  for (const value of [1, 41, 7.5, "8", Number.NaN, undefined])
    assert.equal(isBombChargeTicks(value), false);
});

test("projects along the release angle and clamps each coordinate to safe bounds", () => {
  const bounds = { left: 27, right: 1573, top: 27, bottom: 873 };
  assert.deepEqual(bombLandingPoint(100, 100, 0, 200, bounds), {
    x: 300,
    y: 100,
  });
  assert.deepEqual(bombLandingPoint(1550, 860, Math.PI / 4, 400, bounds), {
    x: 1573,
    y: 873,
  });
  assert.deepEqual(bombLandingPoint(40, 40, Math.PI * 1.25, 400, bounds), {
    x: 27,
    y: 27,
  });
});
