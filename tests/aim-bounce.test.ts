import assert from "node:assert/strict";
import test from "node:test";
import {
  BOMB_MAX_CHARGE_TICKS,
  BOMB_MAX_LAUNCH_DISTANCE,
  BOMB_MIN_LAUNCH_DISTANCE,
  bombLaunchDistance,
  chargeRamp,
} from "../src/engine/bomb-launch.js";
import { bombPreviewDistance } from "../src/client/bomb-preview.js";
import {
  defaultRoomSettings,
  parseRoomSettings,
} from "../src/engine/room-settings.js";

const max = BOMB_MAX_CHARGE_TICKS;
test("without bounce the ramp stops at full reach, as it always has", () => {
  for (const held of [max, max + 1, max * 3])
    assert.equal(
      bombLaunchDistance(held, max, false),
      BOMB_MAX_LAUNCH_DISTANCE,
    );
  assert.equal(bombLaunchDistance(0, max, false), BOMB_MIN_LAUNCH_DISTANCE);
});
test("the ramp holds its shape for every aim window a host can choose", () => {
  for (const window of [2, 3, 5, 8, 24, 40]) {
    assert.equal(
      bombLaunchDistance(window, window, true),
      BOMB_MAX_LAUNCH_DISTANCE,
      `window ${window} peaks at the top`,
    );
    assert.equal(
      bombLaunchDistance(window * 2, window, true),
      BOMB_MIN_LAUNCH_DISTANCE,
      `window ${window} returns to the bottom`,
    );
    for (let held = 0; held <= window * 3; held += 1) {
      assert.equal(
        bombLaunchDistance(held, window, true),
        bombLaunchDistance(held + window * 2, window, true),
        `window ${window} repeats every period`,
      );
      assert.equal(
        chargeRamp(held, window, true),
        chargeRamp(window * 2 - (held % (window * 2)), window, true),
        `window ${window} is symmetric about the peak`,
      );
    }
  }
});
test("with bounce the range walks back to the minimum and climbs again, on a period of twice the window", () => {
  assert.equal(
    bombLaunchDistance(max, max, true),
    BOMB_MAX_LAUNCH_DISTANCE,
    "still peaks at the top of the ramp",
  );
  assert.equal(
    bombLaunchDistance(max * 2, max, true),
    BOMB_MIN_LAUNCH_DISTANCE,
    "a full period later it is back at the bottom",
  );
  assert.equal(
    bombLaunchDistance(max * 3, max, true),
    BOMB_MAX_LAUNCH_DISTANCE,
    "and climbing again",
  );
  for (let held = 0; held <= max * 4; held += 1) {
    assert.equal(
      bombLaunchDistance(held, max, true),
      bombLaunchDistance(held + max * 2, max, true),
      `tick ${held} repeats one period later`,
    );
  }
});
test("the ramp is symmetric around the peak, so the way down offers the same distances as the way up", () => {
  for (let step = 0; step <= max; step += 1)
    assert.equal(
      chargeRamp(max - step, max, true),
      chargeRamp(max + step, max, true),
    );
});
test("every distance stays inside the launch range, bouncing or not", () => {
  for (const bounce of [false, true]) {
    for (let held = 0; held <= max * 5; held += 1) {
      const distance = bombLaunchDistance(held, max, bounce);
      assert.ok(
        distance >= BOMB_MIN_LAUNCH_DISTANCE &&
          distance <= BOMB_MAX_LAUNCH_DISTANCE,
        `held ${held} bounce ${bounce} gave ${distance}`,
      );
    }
  }
});
test("the preview follows the same ramp, including across the turnaround", () => {
  // Whole ticks must agree exactly, or the dashed line promises a landing the release will not honour.
  for (let held = 0; held <= max * 3; held += 1)
    assert.equal(
      bombPreviewDistance(held, max, true),
      bombLaunchDistance(held, max, true),
    );
  // Between ticks it interpolates, so just past the peak it must already be shortening rather than sitting still.
  assert.ok(
    bombPreviewDistance(max + 0.5, max, true) < BOMB_MAX_LAUNCH_DISTANCE,
    "the preview turns around with the ramp",
  );
  assert.equal(
    bombPreviewDistance(max + 0.5, max, false),
    BOMB_MAX_LAUNCH_DISTANCE,
    "clamped previews still park at maximum",
  );
});
test("the saved-settings round trip is a fixed point: both defaults agree", () => {
  const { aimBounce, ...older } = defaultRoomSettings();
  assert.equal(aimBounce, true, "new rooms bounce by default");
  assert.equal(
    parseRoomSettings(older)?.aimBounce,
    true,
    "a blob saved before the flag reads as what a new room would choose",
  );
  assert.deepEqual(
    parseRoomSettings(defaultRoomSettings()),
    defaultRoomSettings(),
    "the defaults survive a round trip unchanged",
  );
  assert.equal(
    parseRoomSettings({ ...defaultRoomSettings(), aimBounce: false })
      ?.aimBounce,
    false,
  );
  assert.equal(
    parseRoomSettings({ ...defaultRoomSettings(), aimBounce: "yes" }),
    undefined,
  );
});
