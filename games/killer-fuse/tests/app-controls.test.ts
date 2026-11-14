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
  HOLD_REPEAT_MS,
  HOLD_REPEAT_STEPS,
  HOLD_TO_FLAP_KEY,
  Keys,
  Pads,
  Touch,
  gameKey,
  holdToFlapFrom,
  settle,
  stickBits,
  type PadLike,
} from "../src/app/controls.js";

function rig() {
  const log: (number | "press" | "attack")[] = [];
  const controls = new Controls({
    input: (bits) => void log.push(bits),
    press: () => void log.push("press"),
    attack: () => void log.push("attack"),
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

test("the source that last held something is the device in use", () => {
  const { controls } = rig();
  assert.equal(controls.lastUsed(), undefined);
  controls.set("pad", 0);
  assert.equal(controls.lastUsed(), undefined, "an idle pad says nothing");
  controls.set("keys", INPUT_LEFT);
  assert.equal(controls.lastUsed(), "keys");
  controls.set("touch", INPUT_HELD);
  controls.set("pad", 0);
  assert.equal(controls.lastUsed(), "touch");
  controls.release();
  assert.equal(controls.lastUsed(), "touch", "letting go keeps the device");
});

test("the keyboard: A/D or arrows move, S or down dives, Space is the one button", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  for (const code of [
    "ArrowLeft",
    "ArrowRight",
    "ArrowDown",
    "KeyA",
    "KeyD",
    "KeyS",
    "Space",
  ])
    assert.ok(gameKey(code), code);
  assert.ok(gameKey("ArrowUp"), "up is kept from scrolling the page");
  for (const code of ["KeyW", "KeyZ", "Enter", "toString"])
    assert.equal(gameKey(code), false, code);
  assert.equal(keys.press("Enter"), false);
  assert.deepEqual(log, []);

  assert.equal(keys.press("KeyA"), true);
  assert.equal(keys.press("KeyA"), true, "key repeat");
  assert.deepEqual(log, [INPUT_LEFT]);
  keys.press("Space");
  assert.deepEqual(log.slice(1), [INPUT_LEFT | INPUT_HELD, "press"]);
  keys.press("Space");
  assert.equal(log.length, 3, "a repeat is not a new press");
  keys.lift("Space");
  assert.equal(controls.value(), INPUT_LEFT);
  keys.press("Space");
  assert.deepEqual(
    log.slice(-2),
    [INPUT_LEFT | INPUT_HELD, "press"],
    "each press is an edge",
  );
  keys.lift("Space");
  keys.lift("Space");
  keys.press("ArrowDown");
  keys.press("ArrowRight");
  assert.equal(controls.value(), INPUT_DOWN);
  keys.lift("ArrowRight");
  keys.lift("ArrowDown");
  keys.press("KeyS");
  assert.equal(controls.value(), INPUT_LEFT | INPUT_DOWN, "S dives too");
  keys.clear();
  assert.equal(controls.value(), 0);
});

test("up and W are bound to nothing: no held bits and no press", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  assert.equal(keys.press("ArrowUp"), true, "swallowed");
  assert.equal(keys.press("KeyW"), false);
  keys.lift("ArrowUp");
  keys.lift("KeyW");
  assert.deepEqual(log, []);
  assert.equal(controls.value(), 0);
  assert.equal(controls.lastUsed(), undefined);
});

test("a gamepad: stick or d-pad past half way to move and dive, A / Cross for the button, up for nothing", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  pads.poll([null, pad([-0.9, 0])]);
  assert.deepEqual(log, [INPUT_LEFT]);
  pads.poll([null, pad([0.2, 0.1])]);
  assert.equal(controls.value(), 0, "inside the dead zone");
  pads.poll([pad([-0.5, 0.5])]);
  assert.equal(controls.value(), 0, "exactly half way is not past it");
  pads.poll([pad([0.51, 0.51])]);
  assert.equal(controls.value(), INPUT_RIGHT | INPUT_DOWN);
  pads.poll([pad([0, 0.49])]);
  assert.equal(
    controls.value(),
    0,
    "a dive needs the stick past half way down",
  );
  pads.poll([pad([0, -1], [12])]);
  assert.equal(controls.value(), 0, "stick up and d-pad up do nothing");
  pads.poll([pad([0, 0], [13, 14])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_DOWN);
  pads.poll([pad([0, 0], [15])]);
  assert.equal(controls.value(), INPUT_RIGHT);
  log.length = 0;
  pads.poll([pad([0, 0], [2, 3])]);
  assert.deepEqual(log, [0], "X and Y are bound to nothing");
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log.slice(1), [INPUT_HELD, "press"]);
  pads.poll([pad([0, 0], [0])]);
  assert.equal(log.length, 3, "held is not pressed again");
  pads.poll([pad([0, 0])]);
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log.slice(3), [0, INPUT_HELD, "press"]);
  // Two pads on one device steer the one unit; a pad with few buttons and no axes is read as far as it goes.
  pads.poll([pad([], [0], 1), pad([-1, 0])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD);
  pads.poll([]);
  assert.equal(controls.value(), 0);
});

/** A clock the test moves by hand. */
class FakeClock {
  ms = 1_000;
  readonly now = (): number => this.ms;
}
function holdRig() {
  const clock = new FakeClock();
  const log: (number | "press")[] = [];
  const controls = new Controls(
    {
      input: (bits) => void log.push(bits),
      press: () => void log.push("press"),
      attack: () => undefined,
    },
    clock.now,
  );
  const presses = () => log.filter((entry) => entry === "press").length;
  return { clock, controls, keys: new Keys(controls), presses };
}

test("hold to flap is off by default: holding the button presses once", () => {
  assert.equal(holdToFlapFrom(null), false);
  assert.equal(holdToFlapFrom("0"), false);
  assert.equal(holdToFlapFrom("1"), true);
  assert.equal(HOLD_TO_FLAP_KEY, "killer-fuse-hold-to-flap");
  const { clock, controls, keys, presses } = holdRig();
  assert.equal(controls.holdsToFlap(), false);
  keys.press("Space");
  for (let frame = 0; frame < 120; frame += 1) {
    clock.ms += 1000 / 60;
    controls.pulse();
  }
  assert.equal(presses(), 1);
});

test("hold to flap: a held button presses again every 8 steps, 7.5 a second", () => {
  assert.equal(HOLD_REPEAT_STEPS, 8);
  assert.equal(HOLD_REPEAT_MS, (8 * 1000) / 60);
  const { clock, controls, keys, presses } = holdRig();
  controls.setHoldToFlap(true);
  assert.equal(controls.holdsToFlap(), true);
  keys.press("Space");
  assert.equal(presses(), 1, "the press itself");
  clock.ms += HOLD_REPEAT_MS - 1;
  controls.pulse();
  assert.equal(presses(), 1, "not yet");
  clock.ms += 1;
  controls.pulse();
  assert.equal(presses(), 2, "8 steps after the press");
  // One more second of frames at 60 Hz: 7 or 8 presses, on the cadence.
  for (let frame = 0; frame < 60; frame += 1) {
    clock.ms += 1000 / 60;
    controls.pulse();
  }
  assert.equal(presses(), 2 + 7);
  keys.lift("Space");
  clock.ms += 1_000;
  controls.pulse();
  assert.equal(presses(), 9, "a released button stops");
});

test("hold to flap: a new tap restarts the count, a stall presses once, and turning it off stops it", () => {
  const { clock, controls, keys, presses } = holdRig();
  controls.setHoldToFlap(true);
  keys.press("Space");
  clock.ms += HOLD_REPEAT_MS / 2;
  keys.lift("Space");
  controls.pulse();
  keys.press("Space");
  clock.ms += HOLD_REPEAT_MS / 2;
  controls.pulse();
  assert.equal(presses(), 2, "counted from the second tap, not the first");
  clock.ms += 10_000;
  controls.pulse();
  assert.equal(presses(), 3, "a hidden tab presses once, not eighty times");
  clock.ms += HOLD_REPEAT_MS - 1;
  controls.pulse();
  assert.equal(presses(), 3, "and counts again from then");
  clock.ms += 1;
  controls.pulse();
  assert.equal(presses(), 4);
  controls.setHoldToFlap(false);
  clock.ms += 1_000;
  controls.pulse();
  assert.equal(presses(), 4);
  // Held already when it is turned on: the first repeat comes a full period later.
  controls.setHoldToFlap(true);
  controls.pulse();
  clock.ms += HOLD_REPEAT_MS;
  controls.pulse();
  assert.equal(presses(), 5);
});

test("a gamepad press restarts the hold-to-flap count as well", () => {
  const { clock, controls, presses } = holdRig();
  controls.setHoldToFlap(true);
  const pads = new Pads(controls);
  pads.poll([pad([0, 0], [0])]);
  clock.ms += HOLD_REPEAT_MS;
  pads.poll([pad([0, 0], [0])]);
  controls.pulse();
  assert.equal(presses(), 2);
  // Without a clock the controls still work; hold to flap simply never comes due.
  const plain = new Controls({
    input: () => undefined,
    press: () => undefined,
    attack: () => undefined,
  });
  plain.setHoldToFlap(true);
  plain.set("keys", INPUT_HELD);
  plain.pulse();
  plain.pulse();
  assert.equal(plain.value(), INPUT_HELD);
});

test("the touch pad: sideways past the dead zone, down on a clear pull, and the big button", () => {
  assert.equal(stickBits(0, 0, 50), 0);
  assert.equal(stickBits(-10, 0, 50), 0);
  assert.equal(stickBits(-12, 0, 50), INPUT_LEFT);
  assert.equal(stickBits(12, 20, 50), INPUT_RIGHT);
  assert.equal(stickBits(0, 26, 50), INPUT_DOWN);
  assert.equal(stickBits(30, 40, 50), INPUT_RIGHT | INPUT_DOWN);
  assert.equal(stickBits(0, -40, 50), 0, "up does nothing");

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

test("attack: J, B / Circle or the left bumper, and the touch ATTACK button, each a press edge only", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  assert.ok(gameKey("KeyJ"));
  keys.press("KeyJ");
  keys.press("KeyJ");
  assert.deepEqual(log, ["attack"], "held J attacks once and holds nothing");
  assert.equal(controls.value(), 0);
  assert.equal(controls.lastUsed(), "keys");
  keys.lift("KeyJ");
  keys.press("KeyJ");
  assert.deepEqual(log, ["attack", "attack"]);

  log.length = 0;
  const pads = new Pads(controls);
  pads.poll([pad([0, 0], [1])]);
  pads.poll([pad([0, 0], [1])]);
  assert.deepEqual(log, ["attack"], "B / Circle, held, attacks once");
  assert.equal(controls.lastUsed(), "pad");
  pads.poll([pad([0, 0], [1, 4])]);
  assert.deepEqual(
    log,
    ["attack", "attack"],
    "the left bumper is its own press",
  );
  pads.poll([pad([0, 0], [0, 4])]);
  assert.deepEqual(log.slice(2), [INPUT_HELD, "press"], "A still flaps");

  log.length = 0;
  const touch = new Touch(controls);
  touch.strike(true);
  touch.strike(true);
  touch.strike(false);
  touch.strike(false);
  touch.strike(true);
  assert.deepEqual(log, ["attack", "attack"]);
  assert.equal(controls.lastUsed(), "touch");
});
