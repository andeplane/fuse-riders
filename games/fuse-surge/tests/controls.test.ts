import test from "node:test";
import assert from "node:assert/strict";
import { DUCK, JUMP, type World } from "../src/engine/index.js";
import {
  HeldControls,
  PadSet,
  autopilotBits,
  bindButton,
  type PadPointer,
  type PadSurface,
} from "../src/app/controls.js";
import {
  GamepadInput,
  STICK_DEAD_ZONE,
  browserGamepads,
  gamepadBits,
  type GamepadLike,
} from "../src/app/gamepad.js";
import { fresh, steps } from "./fixtures/world.js";
import * as T from "../src/engine/tuning.js";

function recorder() {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  return { controls, seen };
}

test("keys are read by code; a bit stays down while anything holds it", () => {
  const { controls, seen } = recorder();
  assert.equal(controls.press("Space"), true);
  assert.equal(controls.press("Space"), true, "a repeat is still ours");
  assert.equal(controls.press("KeyQ"), false);
  assert.equal(controls.release("KeyQ"), false);
  controls.press("ArrowUp");
  assert.deepEqual(seen, [JUMP], "a second jump key changes nothing");
  controls.release("Space");
  assert.equal(controls.bits, JUMP, "the arrow still holds it");
  controls.press("KeyS");
  assert.equal(controls.bits, JUMP | DUCK);
  controls.release("ArrowUp");
  assert.equal(controls.bits, DUCK);
  controls.hold("pad", JUMP);
  controls.hold("pad", JUMP);
  controls.release("KeyS");
  assert.equal(controls.bits, JUMP);
  controls.hold("pad", 0);
  assert.equal(controls.bits, 0);
  assert.deepEqual(seen, [JUMP, JUMP | DUCK, DUCK, JUMP | DUCK, JUMP, 0]);
  for (const code of ["ShiftLeft", "ArrowDown", "KeyJ"]) {
    controls.press(code);
    assert.equal(controls.bits, DUCK, code);
    controls.clear();
  }
  controls.clear();
  assert.equal(seen.at(-1), 0);
});

/** A pad driven by hand. */
function fakeSurface() {
  const listeners: Record<string, ((pointer: PadPointer) => void)[]> = {
    down: [],
    up: [],
  };
  const shown: boolean[] = [];
  let lost = false;
  const surface: PadSurface = {
    on(kind, listener) {
      listeners[kind]!.push(listener);
    },
    capture() {
      if (lost) throw new Error("not tracked");
    },
    show(held) {
      shown.push(held);
    },
  };
  const fire = (kind: "down" | "up", pointerId: number) => {
    for (const listener of listeners[kind]!)
      listener({ pointerId, preventDefault() {} });
  };
  return {
    surface,
    shown,
    fire,
    loseCapture() {
      lost = true;
    },
  };
}

test("a touch button holds while any thumb is on it, even one the browser stopped tracking", () => {
  const pad = fakeSurface();
  const held: number[] = [];
  const letGo = bindButton(pad.surface, DUCK, (bits) => held.push(bits));
  pad.fire("down", 1);
  pad.fire("down", 2);
  pad.fire("up", 1);
  assert.deepEqual(held, [DUCK, DUCK], "one thumb is still down");
  pad.fire("up", 7);
  pad.fire("up", 2);
  assert.deepEqual(held, [DUCK, DUCK, 0]);
  assert.deepEqual(pad.shown, [true, true, false]);
  pad.loseCapture();
  pad.fire("down", 3);
  assert.equal(
    held.at(-1),
    DUCK,
    "a lost capture still holds until the press ends",
  );
  letGo();
  assert.equal(held.at(-1), 0);
  letGo();
  assert.equal(held.length, 5, "nothing down, nothing to let go");
});

test("pads hidden under a thumb let go of it, and so do the controls", () => {
  const { controls, seen } = recorder();
  const pad = fakeSurface();
  const set = new PadSet(controls);
  set.add(bindButton(pad.surface, JUMP, (bits) => controls.hold("jump", bits)));
  set.show(true);
  pad.fire("down", 1);
  controls.press("KeyS");
  assert.equal(controls.bits, JUMP | DUCK);
  set.show(true);
  assert.equal(controls.bits, JUMP | DUCK, "still shown: nothing changes");
  set.show(false);
  assert.equal(controls.bits, 0);
  assert.equal(seen.at(-1), 0);
  pad.fire("up", 1);
  set.show(false);
  pad.fire("down", 2);
  set.release();
  assert.equal(controls.bits, 0);
});

const pad = (
  index: number,
  axes: number[],
  pressed: number[] = [],
  mapping = "standard",
): GamepadLike => ({
  index,
  connected: true,
  mapping,
  axes,
  buttons: Array.from({ length: 16 }, (_, button) => ({
    pressed: pressed.includes(button),
    value: pressed.includes(button) ? 1 : 0,
  })),
});

test("a gamepad's stick, d-pad and buttons map to jump and duck", () => {
  assert.equal(gamepadBits(pad(0, [0, 0])), 0);
  assert.equal(
    gamepadBits(pad(0, [0, -STICK_DEAD_ZONE])),
    0,
    "inside the dead zone",
  );
  assert.equal(gamepadBits(pad(0, [0, -0.8])), JUMP, "stick up");
  assert.equal(gamepadBits(pad(0, [0, 0.8])), DUCK, "stick down");
  assert.equal(gamepadBits(pad(0, [0, 0], [0])), JUMP);
  assert.equal(gamepadBits(pad(0, [0, 0], [1])), DUCK);
  assert.equal(gamepadBits(pad(0, [0, 0], [3, 2])), JUMP | DUCK);
  assert.equal(gamepadBits(pad(0, [0, 0], [12])), JUMP, "d-pad up");
  assert.equal(gamepadBits(pad(0, [0, 0], [13])), DUCK, "d-pad down");
  assert.equal(gamepadBits(pad(0, [0, Number.NaN], [5])), JUMP);
  assert.equal(
    gamepadBits(pad(0, [0], [13], "")),
    0,
    "no d-pad without the standard mapping",
  );
  const analog: GamepadLike = {
    index: 0,
    connected: true,
    mapping: "",
    axes: [],
    buttons: [{ pressed: false, value: 0.9 }],
  };
  assert.equal(gamepadBits(analog), JUMP, "a trigger past half way is down");
});

test("the last pad pressed drives, and a pad held through a pause reads neutral until released", () => {
  let pads: (GamepadLike | null)[] = [pad(0, [0, 0]), pad(1, [0, 0])];
  const held: number[] = [];
  const input = new GamepadInput({ pads: () => pads }, (bits) =>
    held.push(bits),
  );
  input.poll();
  assert.equal(held.at(-1), 0);
  pads = [pad(0, [0, 0]), pad(1, [0, 0], [0])];
  input.poll();
  assert.equal(held.at(-1), JUMP);
  pads = [pad(0, [0, 0.9]), pad(1, [0, 0], [0])];
  input.poll();
  assert.equal(held.at(-1), DUCK, "the newer press takes over");
  input.letGo();
  assert.equal(held.at(-1), 0);
  input.poll();
  assert.equal(held.at(-1), 0, "still held from before the pause");
  pads = [pad(0, [0, 0]), null];
  input.poll();
  pads = [pad(0, [0, -0.9])];
  input.poll();
  assert.equal(held.at(-1), JUMP);
  pads = [{ ...pad(0, [0, -0.9]), connected: false }];
  input.poll();
  assert.equal(held.at(-1), 0, "an unplugged pad holds nothing");
});

test("a browser without gamepads, or one that refuses, has none", () => {
  assert.deepEqual(browserGamepads({}).pads(), []);
  assert.deepEqual(
    browserGamepads({
      getGamepads() {
        throw new Error("policy");
      },
    }).pads(),
    [],
  );
  assert.equal(browserGamepads({ getGamepads: () => [null] }).pads().length, 1);
});

test("the autopilot plays this device's rider only while a match runs", () => {
  const world = fresh({}, 1, ["me", "other"]);
  steps(world, T.READY_STEPS);
  const asked: number[] = [];
  const bot = (_world: World, slot: number) => {
    asked.push(slot);
    return DUCK;
  };
  assert.equal(autopilotBits({ stage: "running", world }, "other", bot), DUCK);
  assert.deepEqual(asked, [1]);
  assert.equal(autopilotBits({ stage: "running", world }, "nobody", bot), 0);
  assert.equal(autopilotBits({ stage: "over", world }, "me", bot), 0);
  assert.equal(autopilotBits({ stage: "running", world: null }, "me", bot), 0);
  assert.equal(autopilotBits(undefined, "me", bot), 0);
  assert.equal(
    autopilotBits({ stage: "running", world }, "me"),
    0,
    "nothing to dodge yet",
  );
});
