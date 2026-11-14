import test from "node:test";
import assert from "node:assert/strict";
import { JUMP, LEFT, RIGHT, type World } from "../src/engine/index.js";
import {
  HeldControls,
  PadSet,
  ROCKER_SLACK,
  autopilotBits,
  bindButton,
  bindRocker,
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
import { fresh } from "./fixtures/world.js";

function recorder() {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  return { controls, seen };
}

test("the newest direction wins, and letting it go returns to the one still held", () => {
  const { controls, seen } = recorder();
  controls.press("KeyA");
  assert.equal(controls.bits, LEFT);
  controls.press("ArrowRight");
  assert.equal(controls.bits, RIGHT, "pressing the other way turns at once");
  controls.release("ArrowRight");
  assert.equal(controls.bits, LEFT, "no dead stop on the way back");
  controls.press("Space");
  assert.equal(controls.bits, LEFT | JUMP);
  controls.release("KeyA");
  controls.release("Space");
  assert.equal(controls.bits, 0);
  assert.deepEqual(seen, [LEFT, RIGHT, LEFT, LEFT | JUMP, JUMP, 0]);
});

test("keys are read by code; repeats and unknown keys change nothing", () => {
  const { controls, seen } = recorder();
  assert.equal(controls.press("KeyQ"), false);
  assert.equal(controls.press("KeyD"), true);
  controls.press("KeyD");
  controls.press("KeyD");
  assert.deepEqual(seen, [RIGHT]);
  assert.equal(controls.release("KeyQ"), false);
});

test("a source that only changes its jump keeps its place in the direction order", () => {
  const { controls } = recorder();
  controls.hold("pad", LEFT);
  controls.press("KeyD");
  assert.equal(controls.bits, RIGHT);
  controls.hold("pad", LEFT | JUMP);
  assert.equal(
    controls.bits,
    RIGHT | JUMP,
    "the pad's jump does not steal the direction",
  );
  controls.clear();
  assert.equal(controls.bits, 0);
});

/** A pad on a 200 px wide box, driven by hand. */
function fakeSurface() {
  const listeners: Record<string, ((pointer: PadPointer) => void)[]> = {
    down: [],
    move: [],
    up: [],
  };
  const shown: { held: boolean; way: -1 | 0 | 1 }[] = [];
  let lost = false;
  const surface: PadSurface = {
    on(kind, listener) {
      listeners[kind]!.push(listener);
    },
    capture() {
      if (lost) throw new Error("not tracked");
    },
    box: () => ({ left: 100, top: 0, width: 200, height: 100 }),
    show(state) {
      shown.push(state);
    },
  };
  const fire = (kind: "down" | "move" | "up", pointerId: number, x: number) => {
    for (const listener of listeners[kind]!)
      listener({ pointerId, clientX: x, clientY: 50, preventDefault() {} });
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

test("the rocker goes the way the thumb lands, then follows a slide either way within a few pixels", () => {
  const pad = fakeSurface();
  const bits: number[] = [];
  bindRocker(pad.surface, (held) => bits.push(held));
  pad.fire("down", 1, 150);
  assert.deepEqual(bits, [LEFT], "the left half runs left at once");
  pad.fire("move", 1, 150 + ROCKER_SLACK);
  assert.deepEqual(bits, [LEFT], "a wobble inside the slack changes nothing");
  pad.fire("move", 1, 150 + ROCKER_SLACK + 1);
  assert.deepEqual(bits, [LEFT, RIGHT]);
  pad.fire("move", 1, 260);
  pad.fire("move", 1, 260 - ROCKER_SLACK - 1);
  assert.deepEqual(
    bits,
    [LEFT, RIGHT, LEFT],
    "sliding back reverses from wherever the thumb is",
  );
  pad.fire("down", 2, 280);
  assert.deepEqual(
    bits,
    [LEFT, RIGHT, LEFT],
    "a second thumb does not take the rocker",
  );
  pad.fire("up", 2, 280);
  pad.fire("up", 1, 200);
  assert.deepEqual(bits, [LEFT, RIGHT, LEFT, 0]);
  assert.deepEqual(pad.shown.at(-1), { held: false, way: 0 });
});

test("the rocker's right half runs right, and a lost capture still holds until the press ends", () => {
  const pad = fakeSurface();
  const bits: number[] = [];
  const letGo = bindRocker(pad.surface, (held) => bits.push(held));
  pad.loseCapture();
  pad.fire("down", 4, 250);
  assert.deepEqual(bits, [RIGHT]);
  letGo();
  assert.deepEqual(bits, [RIGHT, 0]);
  letGo();
  assert.deepEqual(bits, [RIGHT, 0], "letting go twice says it once");
});

test("the jump button holds while any thumb is on it", () => {
  const pad = fakeSurface();
  const bits: number[] = [];
  bindButton(pad.surface, JUMP, (held) => bits.push(held));
  pad.fire("down", 1, 150);
  pad.fire("down", 2, 160);
  pad.fire("up", 1, 150);
  assert.deepEqual(bits, [JUMP, JUMP]);
  pad.fire("up", 2, 160);
  assert.deepEqual(bits, [JUMP, JUMP, 0]);
});

test("pads hidden under a thumb let go of it", () => {
  const { controls } = recorder();
  const pad = fakeSurface();
  const set = new PadSet(controls);
  set.add(bindButton(pad.surface, JUMP, (held) => controls.hold("jump", held)));
  set.show(true);
  pad.fire("down", 1, 150);
  assert.equal(controls.bits, JUMP);
  set.show(false);
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
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
});

test("a gamepad's stick, d-pad and face buttons map to run and jump", () => {
  assert.equal(gamepadBits(pad(0, [0])), 0);
  assert.equal(
    gamepadBits(pad(0, [-STICK_DEAD_ZONE])),
    0,
    "inside the dead zone",
  );
  assert.equal(gamepadBits(pad(0, [-0.6])), LEFT);
  assert.equal(gamepadBits(pad(0, [0.6], [0])), RIGHT | JUMP);
  assert.equal(gamepadBits(pad(0, [0], [12])), JUMP, "d-pad up jumps");
  assert.equal(
    gamepadBits(pad(0, [-0.9], [15])),
    RIGHT,
    "the d-pad overrides the stick",
  );
  assert.equal(gamepadBits(pad(0, [Number.NaN], [3])), JUMP);
  assert.equal(
    gamepadBits(pad(0, [0], [12], "")),
    0,
    "no d-pad without the standard mapping",
  );
});

test("the last pad pressed drives, and a pad held through a pause reads neutral until released", () => {
  let pads: (GamepadLike | null)[] = [pad(0, [0.2]), pad(1, [0])];
  const held: number[] = [];
  const input = new GamepadInput({ pads: () => pads }, (bits) =>
    held.push(bits),
  );
  input.poll();
  assert.equal(held.at(-1), 0, "a resting stick off centre is not a press");
  pads = [pad(0, [0.2]), pad(1, [0], [0])];
  input.poll();
  assert.equal(held.at(-1), JUMP);
  pads = [pad(0, [-0.8]), pad(1, [0], [0])];
  input.poll();
  assert.equal(held.at(-1), LEFT, "the newer press takes over");
  input.letGo();
  assert.equal(held.at(-1), 0);
  input.poll();
  assert.equal(held.at(-1), 0, "still held from before the pause");
  pads = [pad(0, [0]), null];
  input.poll();
  pads = [pad(0, [0.9])];
  input.poll();
  assert.equal(held.at(-1), RIGHT);
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
});

test("the autopilot plays this device's blob only while a match runs", () => {
  const world: World = fresh();
  const asked: number[] = [];
  const bot = (_world: World, side: number) => {
    asked.push(side);
    return RIGHT;
  };
  assert.equal(
    autopilotBits({ stage: "running", world }, "blob-b", bot),
    RIGHT,
  );
  assert.deepEqual(asked, [1]);
  assert.equal(autopilotBits({ stage: "over", world }, "blob-b", bot), 0);
  assert.equal(autopilotBits({ stage: "running", world }, "nobody", bot), 0);
  assert.equal(autopilotBits(undefined, "blob-b", bot), 0);
});

test("releasing a pad set lets go of a thumb still down, which must lift to press again", () => {
  const { controls } = recorder();
  const pad = fakeSurface();
  const set = new PadSet(controls);
  set.add(bindRocker(pad.surface, (held) => controls.hold("rocker", held)));
  pad.fire("down", 1, 150);
  assert.equal(controls.bits, LEFT);
  set.release();
  assert.equal(controls.bits, 0);
  assert.deepEqual(pad.shown.at(-1), { held: false, way: 0 });
  pad.fire("move", 1, 290);
  assert.equal(controls.bits, 0);
  pad.fire("up", 1, 290);
  pad.fire("down", 2, 290);
  assert.equal(controls.bits, RIGHT);
});
