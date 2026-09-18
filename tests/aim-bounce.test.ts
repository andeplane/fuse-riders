import assert from "node:assert/strict";
import test from "node:test";
import {
  BOMB_MAX_CHARGE_TICKS,
  BOMB_MAX_AIM_HOLD_TICKS,
  BOMB_MAX_LAUNCH_DISTANCE,
  BOMB_MIN_LAUNCH_DISTANCE,
  bombLaunchDistance,
  chargeRamp,
} from "../src/engine/bomb-launch.js";
import { bombPreviewDistance } from "../src/render/bomb-preview.js";
import {
  defaultRoomSettings,
  parseRoomSettings,
} from "../src/engine/room-settings.js";

const max = BOMB_MAX_CHARGE_TICKS;
const dwell = BOMB_MAX_AIM_HOLD_TICKS;
test("maximum reach holds for 100 ms before smoothly shrinking, for every aim window", () => {
  assert.equal(dwell, 2);
  for (let window = 2; window <= 40; window++) {
    for (let offset = 0; offset <= dwell; offset += 0.25)
      assert.equal(bombPreviewDistance(window + offset, window, true), 400);
    assert.ok(bombPreviewDistance(window - 0.01, window, true) < 400);
    assert.ok(bombPreviewDistance(window + dwell + 0.01, window, true) < 400);
  }
});
test("most of the aim range stays linear, with smooth joins into the endpoint easing", () => {
  // Central 60% of each leg's time covers 75% of the distance at a constant speed.
  for (let age = 2; age <= 6; age += 0.25) {
    const step =
      bombPreviewDistance(age + 0.25, max, true) -
      bombPreviewDistance(age, max, true);
    assert.ok(Math.abs(step - 11.71875) < 1e-10);
  }
  for (const join of [1.6, 6.4, 9.6 + dwell, 14.4 + dwell]) {
    const dt = 0.001;
    const before =
      (bombPreviewDistance(join, max, true) -
        bombPreviewDistance(join - dt, max, true)) /
      dt;
    const after =
      (bombPreviewDistance(join + dt, max, true) -
        bombPreviewDistance(join, max, true)) /
      dt;
    assert.ok(
      Math.abs(before - after) < 0.001,
      "no speed jump where easing meets linear motion",
    );
  }
});

test("bouncing aim eases on both legs around the brief maximum hold", () => {
  for (let window = 2; window <= 40; window++) {
    const outward = Array.from({ length: window + 1 }, (_, tick) =>
      bombLaunchDistance(tick, window, true),
    );
    let previousStep = Infinity;
    for (let tick = 1; tick <= window; tick++) {
      const step = outward[tick]! - outward[tick - 1]!;
      assert.ok(step > 0, `window ${window}: aim never parks`);
      if (tick > window * 0.8 + 1)
        assert.ok(
          step < previousStep,
          `window ${window}: approach decelerates`,
        );
      else if (tick > 1 && tick <= window * 0.2)
        assert.ok(
          step > previousStep,
          `window ${window}: departure accelerates`,
        );
      assert.equal(
        bombLaunchDistance(2 * window + dwell - tick, window, true),
        outward[tick],
      );
      previousStep = step;
    }
  }
  assert.ok(Math.abs(bombLaunchDistance(4, 8, true) - 250) < 1e-10);
  assert.ok(Math.abs(bombLaunchDistance(12 + dwell, 8, true) - 250) < 1e-10);
  assert.equal(
    bombLaunchDistance(4.75, 8, true),
    bombLaunchDistance(4, 8, true),
    "releases stay on the tick grid",
  );
});

test("fractional previews ease within each tick and reverse with continuous velocity entering and leaving the maximum hold", () => {
  // The closer we sample to a turning point, the smaller its velocity; the minimum reverses immediately and the maximum holds briefly.
  for (const endpoint of [0, max + dwell]) {
    const dt = 0.001;
    const at = bombPreviewDistance(endpoint, max, true);
    const near = Math.abs(bombPreviewDistance(endpoint + dt, max, true) - at);
    const far = Math.abs(
      bombPreviewDistance(endpoint + 2 * dt, max, true) - at,
    );
    assert.ok(near > 0 && near < far / 3);
    assert.ok(
      near / dt < 0.02,
      "endpoint velocity tends to zero without a pause",
    );
  }
  for (const hz of [30, 60, 120]) {
    const dt = 20 / hz;
    const peak = bombPreviewDistance(max, max, true);
    let previousStep = 0;
    for (let frame = 1; frame <= hz * 0.08; frame++) {
      const age = frame * dt;
      const before = bombPreviewDistance(max + dwell + age - dt, max, true);
      const after = bombPreviewDistance(max + dwell + age, max, true);
      const step = before - after;
      assert.ok(
        step > previousStep,
        `${hz} Hz: return accelerates every frame`,
      );

      assert.ok(
        Math.abs(after - bombPreviewDistance(max - age, max, true)) < 1e-10,
      );
      previousStep = step;
    }
    assert.ok(bombPreviewDistance(max - dt, max, true) < peak);
    assert.ok(bombPreviewDistance(max + dwell + dt, max, true) < peak);
  }
});

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
      bombLaunchDistance(window * 2 + dwell, window, true),
      BOMB_MIN_LAUNCH_DISTANCE,
      `window ${window} returns to the bottom`,
    );
    for (let held = 0; held <= window * 3; held += 1) {
      assert.equal(
        bombLaunchDistance(held, window, true),
        bombLaunchDistance(held + (window * 2 + dwell), window, true),
        `window ${window} repeats every period`,
      );
      assert.equal(
        chargeRamp(held, window, true),
        chargeRamp(
          window * 2 + dwell - (held % (window * 2 + dwell)),
          window,
          true,
        ),
        `window ${window} is symmetric about the peak`,
      );
    }
  }
});
test("with bounce the range walks back to the minimum and climbs again, on a period of twice the window plus the maximum hold", () => {
  assert.equal(
    bombLaunchDistance(max, max, true),
    BOMB_MAX_LAUNCH_DISTANCE,
    "still peaks at the top of the ramp",
  );
  assert.equal(
    bombLaunchDistance(max * 2 + dwell, max, true),
    BOMB_MIN_LAUNCH_DISTANCE,
    "a full period later it is back at the bottom",
  );
  assert.equal(
    bombLaunchDistance(max * 3 + dwell, max, true),
    BOMB_MAX_LAUNCH_DISTANCE,
    "and climbing again",
  );
  for (let held = 0; held <= max * 4; held += 1) {
    assert.equal(
      bombLaunchDistance(held, max, true),
      bombLaunchDistance(held + max * 2 + dwell, max, true),
      `tick ${held} repeats one period later`,
    );
  }
});
test("the ramp is symmetric around the peak, so the way down offers the same distances as the way up", () => {
  for (let step = 0; step <= max; step += 1)
    assert.equal(
      chargeRamp(max - step, max, true),
      chargeRamp(max + dwell + step, max, true),
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
  // Between ticks it samples the curve, so after the maximum hold it must be shortening.
  assert.ok(
    bombPreviewDistance(max + dwell + 0.5, max, true) <
      BOMB_MAX_LAUNCH_DISTANCE,
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
