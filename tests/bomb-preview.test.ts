import assert from "node:assert/strict";
import test from "node:test";
import { bombPreviewDistance } from "../src/client/bomb-preview.js";
import {
  BOMB_MAX_CHARGE_TICKS,
  bombLaunchDistance,
} from "../src/shared/bomb-launch.js";

test("preview extends every rendered frame at 30, 60 and 120 Hz while releases retain whole ticks", () => {
  for (const hz of [30, 60, 120]) {
    let previous = bombPreviewDistance(0);
    for (let frame = 1; frame <= hz * 0.4; frame++) {
      const age = (frame * 20) / hz;
      const distance = bombPreviewDistance(age);
      assert.ok(distance > previous, `${hz} Hz frame ${frame} must extend`);
      assert.ok(Math.abs(distance - (100 + (750 * frame) / hz)) < 1e-10);
      previous = distance;
    }
  }
  for (let tick = 0; tick <= BOMB_MAX_CHARGE_TICKS; tick++) {
    assert.equal(bombPreviewDistance(tick), bombLaunchDistance(tick));
  }
  assert.equal(
    bombLaunchDistance(0.75),
    100,
    "authoritative launch still rounds down",
  );
  assert.equal(bombPreviewDistance(0.75), 128.125);
});

test("preview clamps before charge and after full charge, including invalid ages", () => {
  for (const age of [-1, NaN, Infinity, -Infinity])
    assert.equal(bombPreviewDistance(age), 100);
  for (const age of [8, 8.5, 999]) assert.equal(bombPreviewDistance(age), 400);
});

test("custom aim time controls fractional preview and authoritative range together", () => {
  for (const duration of [2, 8, 24, 40]) {
    assert.equal(bombPreviewDistance(duration / 2, duration), 250);
    assert.equal(bombLaunchDistance(duration / 2, duration), 250);
    assert.equal(bombPreviewDistance(duration + 0.5, duration), 400);
    assert.equal(bombLaunchDistance(duration + 1, duration), 400);
    assert.equal(bombPreviewDistance(0.5, duration), 100 + 150 / duration);
  }
});
