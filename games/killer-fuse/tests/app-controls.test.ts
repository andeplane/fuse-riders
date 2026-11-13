import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
} from "../src/engine/index.js";
import {
  Controls,
  Keys,
  Pads,
  Touch,
  gameKey,
  settle,
  stickBits,
  type PadLike,
} from "../src/app/controls.js";

function rig() {
  const log: (number | "press")[] = [];
  const controls = new Controls({
    input: (bits) => void log.push(bits),
    press: () => void log.push("press"),
  });
  return { log, controls };
}
const pad = (
  axes: number[],
  pressed: number[] = [],
  buttons = 16,
): PadLike => ({
  axes,
  buttons: Array.from({ length: buttons }, (_, index) => ({
    pressed: pressed.includes(index),
  })),
});

test("left and right together are neither", () => {
  assert.equal(settle(INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN), INPUT_DOWN);
  assert.equal(settle(INPUT_LEFT | INPUT_HELD), INPUT_LEFT | INPUT_HELD);
});

test("the sources merge, and only a change reaches the runtime", () => {
  const { log, controls } = rig();
  controls.set("keys", INPUT_LEFT);
  controls.set("pad", INPUT_LEFT);
  controls.set("touch", INPUT_HELD);
  assert.deepEqual(log, [INPUT_LEFT, INPUT_LEFT | INPUT_HELD]);
  controls.set("keys", 0);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD, "the pad holds left");
  controls.set("pad", INPUT_RIGHT);
  controls.set("keys", INPUT_LEFT);
  assert.equal(controls.value(), INPUT_HELD);
  controls.release();
  assert.equal(controls.value(), 0);
  assert.equal(log.at(-1), 0);
  controls.press();
  assert.equal(log.at(-1), "press");
});

test("the keyboard: arrows or WASD, and every button key is its own press", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  for (const code of [
    "ArrowLeft",
    "ArrowRight",
    "ArrowDown",
    "ArrowUp",
    "KeyA",
    "KeyD",
    "KeyS",
    "KeyW",
    "Space",
    "KeyZ",
  ])
    assert.ok(gameKey(code), code);
  assert.equal(gameKey("Enter"), false);
  assert.equal(gameKey("toString"), false);
  assert.equal(keys.press("Enter"), false);
  assert.deepEqual(log, []);

  assert.equal(keys.press("KeyA"), true);
  assert.equal(keys.press("KeyA"), true, "key repeat");
  assert.deepEqual(log, [INPUT_LEFT]);
  keys.press("Space");
  assert.deepEqual(log.slice(1), [INPUT_LEFT | INPUT_HELD, "press"]);
  keys.press("Space");
  assert.equal(log.length, 3, "a repeat is not a new press");
  keys.press("KeyZ");
  assert.deepEqual(log.slice(3), ["press"], "a second finger flaps again");
  keys.lift("Space");
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD, "Z is still down");
  keys.lift("KeyZ");
  assert.equal(controls.value(), INPUT_LEFT);
  keys.lift("KeyZ");
  keys.press("ArrowDown");
  keys.press("ArrowRight");
  assert.equal(controls.value(), INPUT_DOWN);
  keys.clear();
  assert.equal(controls.value(), 0);
  keys.press("ArrowUp");
  assert.deepEqual(log.slice(-2), [INPUT_HELD, "press"]);
});

test("a gamepad: stick or d-pad to move, each face button its own press", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  pads.poll([null, pad([-0.9, 0])]);
  assert.deepEqual(log, [INPUT_LEFT]);
  pads.poll([null, pad([0.2, 0.1])]);
  assert.equal(controls.value(), 0, "inside the dead zone");
  pads.poll([pad([0.9, 0.9])]);
  assert.equal(controls.value(), INPUT_RIGHT | INPUT_DOWN);
  pads.poll([pad([0, 0], [13, 14])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_DOWN);
  pads.poll([pad([0, 0], [15])]);
  assert.equal(controls.value(), INPUT_RIGHT);
  log.length = 0;
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log, [INPUT_HELD, "press"]);
  pads.poll([pad([0, 0], [0])]);
  assert.equal(log.length, 2, "held is not pressed again");
  pads.poll([pad([0, 0], [0, 1])]);
  assert.deepEqual(log.slice(2), ["press"], "B while A is down");
  pads.poll([pad([0, 0])]);
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log.slice(3), [0, INPUT_HELD, "press"]);
  // Two pads on one device steer the one unit; a pad with few buttons and no axes is read as far as it goes.
  pads.poll([pad([], [0], 1), pad([-1, 0])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD);
  pads.poll([]);
  assert.equal(controls.value(), 0);
});

test("the touch pad: sideways past the dead zone, down on a clear pull, and the big button", () => {
  assert.equal(stickBits(0, 0, 50), 0);
  assert.equal(stickBits(-10, 0, 50), 0);
  assert.equal(stickBits(-12, 0, 50), INPUT_LEFT);
  assert.equal(stickBits(12, 20, 50), INPUT_RIGHT);
  assert.equal(stickBits(0, 26, 50), INPUT_DOWN);
  assert.equal(stickBits(30, 40, 50), INPUT_RIGHT | INPUT_DOWN);
  assert.equal(stickBits(0, -40, 50), 0, "up is the button's");

  const { log, controls } = rig();
  const touch = new Touch(controls);
  touch.move(-30, 0, 50);
  touch.hold(true);
  touch.hold(true);
  assert.deepEqual(log, [INPUT_LEFT, INPUT_LEFT | INPUT_HELD, "press"]);
  touch.rest();
  assert.equal(controls.value(), INPUT_HELD);
  touch.hold(false);
  touch.hold(false);
  assert.equal(controls.value(), 0);
  touch.hold(true);
  assert.deepEqual(log.slice(-2), [INPUT_HELD, "press"]);
});
