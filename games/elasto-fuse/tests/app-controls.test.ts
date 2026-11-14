import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAKE,
  GAS,
  RESTART,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
} from "../src/engine/index.js";
import {
  HeldControls,
  KEYS,
  PadSet,
  TOUCH_BUTTONS,
  bindButton,
  type PadPointer,
  type PadSurface,
} from "../src/app/controls.js";
import {
  GamepadInput,
  TRIGGER_POINT,
  browserGamepads,
  gamepadBits,
  type GamepadLike,
} from "../src/app/gamepad.js";

function recorder() {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  return { controls, seen };
}

test("the keyboard maps to gas, brake, the volts, turn and restart, by key code", () => {
  const expected: Record<string, number> = {
    ArrowUp: GAS,
    KeyW: GAS,
    ArrowDown: BRAKE,
    KeyS: BRAKE,
    ArrowLeft: VOLT_LEFT,
    KeyA: VOLT_LEFT,
    ArrowRight: VOLT_RIGHT,
    KeyD: VOLT_RIGHT,
    Space: TURN,
    Enter: RESTART,
    KeyR: RESTART,
  };
  assert.deepEqual({ ...KEYS }, expected);
  for (const [code, bits] of Object.entries(expected)) {
    const { controls } = recorder();
    assert.equal(controls.press(code), true, code);
    assert.equal(controls.bits, bits, code);
    assert.equal(controls.release(code), true, code);
    assert.equal(controls.bits, 0, code);
  }
});

test("held keys add up; letting one go leaves the others; repeats and unknown keys change nothing", () => {
  const { controls, seen } = recorder();
  assert.equal(controls.press("KeyQ"), false);
  controls.press("ArrowUp");
  controls.press("ArrowUp");
  controls.press("ArrowLeft");
  assert.equal(controls.bits, GAS | VOLT_LEFT);
  controls.press("Space");
  controls.release("Space");
  controls.release("ArrowUp");
  assert.equal(controls.bits, VOLT_LEFT);
  controls.release("ArrowLeft");
  assert.equal(controls.release("KeyQ"), false);
  assert.deepEqual(seen, [
    GAS,
    GAS | VOLT_LEFT,
    GAS | VOLT_LEFT | TURN,
    GAS | VOLT_LEFT,
    VOLT_LEFT,
    0,
  ]);
});

test("two keys for one control hold it until both are up, and a source holds beside the keys", () => {
  const { controls, seen } = recorder();
  controls.press("ArrowUp");
  controls.press("KeyW");
  controls.release("ArrowUp");
  assert.equal(controls.bits, GAS, "W still holds the gas");
  controls.hold("gamepad", BRAKE);
  assert.equal(controls.bits, GAS | BRAKE);
  controls.release("KeyW");
  assert.equal(controls.bits, BRAKE);
  controls.hold("gamepad", 0);
  assert.deepEqual(seen, [GAS, GAS | BRAKE, BRAKE, 0]);
});

test("clearing lets go of everything at once, and says so once", () => {
  const { controls, seen } = recorder();
  controls.press("ArrowUp");
  controls.hold("pad", TURN);
  controls.clear();
  controls.clear();
  assert.equal(controls.bits, 0);
  assert.deepEqual(seen, [GAS, GAS | TURN, 0]);
  // A key that was down through the clear must go down again to count.
  controls.release("ArrowUp");
  assert.deepEqual(seen, [GAS, GAS | TURN, 0]);
});

/** A touch button driven by hand. */
function fakeSurface(throwOnCapture = false) {
  const listeners: Record<"down" | "up", ((p: PadPointer) => void)[]> = {
    down: [],
    up: [],
  };
  const shown: boolean[] = [],
    captured: number[] = [];
  let prevented = 0;
  const surface: PadSurface = {
    on: (kind, listener) => listeners[kind].push(listener),
    capture(pointerId) {
      if (throwOnCapture) throw new Error("no such pointer");
      captured.push(pointerId);
    },
    show: (held) => shown.push(held),
  };
  const fire = (kind: "down" | "up", pointerId: number) =>
    listeners[kind].forEach((listener) =>
      listener({ pointerId, preventDefault: () => void prevented++ }),
    );
  return {
    surface,
    shown,
    captured,
    down: (id: number) => fire("down", id),
    up: (id: number) => fire("up", id),
    prevented: () => prevented,
  };
}

test("a touch button holds its bits while a thumb is down, and lets go when it lifts or is cancelled", () => {
  const pad = fakeSurface(),
    seen: number[] = [];
  bindButton(pad.surface, GAS, (bits) => seen.push(bits));
  pad.down(1);
  assert.deepEqual(seen, [GAS]);
  assert.deepEqual(
    pad.captured,
    [1],
    "the press is kept when the thumb slides off",
  );
  assert.equal(pad.prevented(), 1, "the touch never scrolls or zooms the page");
  // `up` is every way a press ends: lifted, cancelled by the browser, or its capture lost.
  pad.up(1);
  assert.deepEqual(seen, [GAS, 0]);
  assert.deepEqual(pad.shown, [true, false]);
  // A stray end for a pointer that never pressed says nothing.
  pad.up(7);
  assert.deepEqual(seen, [GAS, 0]);
});

test("two thumbs on one button hold it until both are up; a failed capture still holds", () => {
  const pad = fakeSurface(true),
    seen: number[] = [];
  bindButton(pad.surface, BRAKE, (bits) => seen.push(bits));
  pad.down(1);
  pad.down(2);
  pad.up(1);
  assert.equal(seen.at(-1), BRAKE, "the second thumb still holds");
  pad.up(2);
  assert.equal(seen.at(-1), 0);
});

test("two buttons under two thumbs are two holds", () => {
  const { controls, seen } = recorder();
  const gas = fakeSurface(),
    volt = fakeSurface();
  bindButton(gas.surface, GAS, (bits) => controls.hold("gas", bits));
  bindButton(volt.surface, VOLT_RIGHT, (bits) => controls.hold("volt", bits));
  gas.down(1);
  volt.down(2);
  volt.up(2);
  gas.up(1);
  assert.deepEqual(seen, [GAS, GAS | VOLT_RIGHT, GAS, 0]);
});

test("buttons that go off screen let go, and so does a menu opening", () => {
  const { controls, seen } = recorder();
  const pad = fakeSurface(),
    set = new PadSet(controls);
  set.add(bindButton(pad.surface, GAS, (bits) => controls.hold("gas", bits)));
  set.show(true);
  pad.down(1);
  controls.press("ArrowLeft");
  set.show(false);
  assert.equal(controls.bits, 0, "a hidden button never hears its thumb lift");
  assert.equal(pad.shown.at(-1), false);
  // The thumb's late lift is not a second release.
  pad.up(1);
  assert.deepEqual(seen, [GAS, GAS | VOLT_LEFT, VOLT_LEFT, 0]);
  set.show(true);
  pad.down(2);
  set.release();
  assert.equal(controls.bits, 0);
});

test("the touch layout offers every control once", () => {
  assert.deepEqual(
    TOUCH_BUTTONS.map((each) => each.bits).sort((a, b) => a - b),
    [GAS, BRAKE, VOLT_LEFT, VOLT_RIGHT, TURN, RESTART],
  );
  assert.equal(new Set(TOUCH_BUTTONS.map((each) => each.id)).size, 6);
});

function pad(
  index: number,
  pressed: readonly number[],
  options: { mapping?: string; values?: Record<number, number> } = {},
): GamepadLike {
  return {
    index,
    connected: true,
    mapping: options.mapping ?? "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, button) => ({
      pressed: pressed.includes(button),
      value: options.values?.[button] ?? (pressed.includes(button) ? 1 : 0),
    })),
  };
}

test("a gamepad: A or RT gas, B or LT brake, bumpers or d-pad volt, X turn, Y restart", () => {
  assert.equal(gamepadBits(pad(0, [])), 0);
  assert.equal(gamepadBits(pad(0, [0])), GAS);
  assert.equal(gamepadBits(pad(0, [7])), GAS);
  assert.equal(gamepadBits(pad(0, [1])), BRAKE);
  assert.equal(gamepadBits(pad(0, [6])), BRAKE);
  assert.equal(gamepadBits(pad(0, [4])), VOLT_LEFT);
  assert.equal(gamepadBits(pad(0, [14])), VOLT_LEFT);
  assert.equal(gamepadBits(pad(0, [5])), VOLT_RIGHT);
  assert.equal(gamepadBits(pad(0, [15])), VOLT_RIGHT);
  assert.equal(gamepadBits(pad(0, [2])), TURN);
  assert.equal(gamepadBits(pad(0, [3])), RESTART);
  assert.equal(gamepadBits(pad(0, [0, 5, 2])), GAS | VOLT_RIGHT | TURN);
  // An analogue trigger counts once it is pulled far enough.
  assert.equal(
    gamepadBits(pad(0, [], { values: { 7: TRIGGER_POINT + 0.05 } })),
    GAS,
  );
  assert.equal(
    gamepadBits(pad(0, [], { values: { 7: TRIGGER_POINT - 0.05 } })),
    0,
  );
  // Without the standard mapping the d-pad's buttons may be anything.
  assert.equal(gamepadBits(pad(0, [14, 0], { mapping: "" })), GAS);
});

test("the last pad to press drives; a pad held through a pause reads as let go until it lets go itself", () => {
  let pads: (GamepadLike | null)[] = [];
  const seen: number[] = [];
  const input = new GamepadInput({ pads: () => pads }, (bits) =>
    seen.push(bits),
  );
  pads = [pad(0, [0]), pad(1, [])];
  input.poll();
  assert.equal(seen.at(-1), GAS);
  pads = [pad(0, [0]), pad(1, [1])];
  input.poll();
  assert.equal(seen.at(-1), BRAKE, "the pad that pressed last drives");
  // The menu opens: nothing is held, and the button still down does not come back when it closes.
  input.poll(false);
  assert.equal(seen.at(-1), 0);
  input.poll(true);
  assert.equal(seen.at(-1), 0, "still down from before the pause");
  pads = [pad(0, []), pad(1, [])];
  input.poll(true);
  pads = [pad(0, []), pad(1, [1])];
  input.poll(true);
  assert.equal(seen.at(-1), BRAKE, "pressed again after letting go");
  // The driving pad is unplugged.
  pads = [pad(0, [])];
  input.poll(true);
  assert.equal(seen.at(-1), 0);
  input.letGo();
  assert.equal(seen.at(-1), 0);
});

test("a browser without gamepads, or one that refuses, has none", () => {
  assert.deepEqual(browserGamepads({}).pads(), []);
  assert.deepEqual(
    browserGamepads({
      getGamepads() {
        throw new Error("blocked by policy");
      },
    }).pads(),
    [],
  );
  const one = pad(0, [0]);
  assert.deepEqual(browserGamepads({ getGamepads: () => [one] }).pads(), [one]);
});
