import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  DOWN,
  LEFT,
  RIGHT,
  UP,
  botInput,
  isInput,
  stepWorld,
} from "../src/engine/index.js";
import { ballAt, playing } from "./fixtures/world.js";
import {
  DEAD_ZONE,
  HeldControls,
  KEYS,
  PadSet,
  autopilotBits,
  bindButton,
  bindStick,
  stickFrom,
  type PadPointer,
  type PadSurface,
} from "../src/app/controls.js";

/** A pad that is not an element: a 100×100 box at (200, 300), whose presses the test fires by hand. */
class FakePad implements PadSurface {
  readonly listeners = new Map<string, ((pointer: PadPointer) => void)[]>();
  readonly captured: number[] = [];
  readonly shown: { held: boolean; x: number; y: number }[] = [];
  refuseCapture = false;
  on(kind: "down" | "move" | "up", listener: (pointer: PadPointer) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  capture(pointerId: number): void {
    if (this.refuseCapture) throw new Error("no such pointer");
    this.captured.push(pointerId);
  }
  box() {
    return { left: 200, top: 300, width: 100, height: 100 };
  }
  show(state: { held: boolean; x: number; y: number }): void {
    this.shown.push(state);
  }
  /** Fires `kind` for pointer `id` at an offset from the pad's centre; returns how often the default was prevented. */
  fire(kind: "down" | "move" | "up", id: number, dx = 0, dy = 0): number {
    let prevented = 0;
    const pointer: PadPointer = {
      pointerId: id,
      clientX: 250 + dx,
      clientY: 350 + dy,
      preventDefault: () => void prevented++,
    };
    for (const listener of this.listeners.get(kind) ?? []) listener(pointer);
    return prevented;
  }
}

test("held controls: keys by code, touch sources, and one change at a time", () => {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  assert.equal(controls.press("KeyQ"), false);
  assert.equal(controls.release("KeyQ"), false);
  assert.equal(controls.press("KeyD"), true);
  assert.equal(controls.press("KeyD"), true, "a repeat is ours too");
  controls.press("Space");
  controls.press("KeyJ");
  assert.equal(controls.bits, RIGHT | BTN);
  controls.release("Space");
  assert.equal(controls.bits, RIGHT | BTN, "J still holds the button");
  controls.release("KeyJ");
  controls.hold("stick", DOWN);
  controls.hold("jump", BTN);
  controls.hold("jump", 0);
  controls.release("KeyD");
  assert.deepEqual(seen, [
    RIGHT,
    RIGHT | BTN,
    RIGHT,
    RIGHT | DOWN,
    RIGHT | DOWN | BTN,
    RIGHT | DOWN,
    DOWN,
  ]);
  controls.clear();
  controls.clear();
  assert.deepEqual(seen.at(-1), 0);
  assert.equal(seen.length, 8, "clearing twice is one change");
  // The arrows and WASD are the same stick; Space, J and K the same button.
  for (const [code, bits] of [
    ["ArrowUp", UP],
    ["KeyW", UP],
    ["ArrowDown", DOWN],
    ["KeyS", DOWN],
    ["ArrowLeft", LEFT],
    ["KeyA", LEFT],
    ["ArrowRight", RIGHT],
    ["KeyD", RIGHT],
    ["Space", BTN],
    ["KeyJ", BTN],
    ["KeyK", BTN],
  ] as const)
    assert.equal(KEYS[code], bits, code);
});

test("the stick reads eight ways outside a dead zone", () => {
  assert.equal(stickFrom(0, 0, 50), 0);
  assert.equal(stickFrom(50 * DEAD_ZONE - 1, 0, 50), 0);
  assert.equal(stickFrom(50 * DEAD_ZONE + 1, 0, 50), RIGHT);
  assert.equal(stickFrom(-40, 0, 50), LEFT);
  assert.equal(stickFrom(0, -40, 50), UP);
  assert.equal(stickFrom(0, 40, 50), DOWN);
  assert.equal(stickFrom(30, 30, 50), RIGHT | DOWN);
  assert.equal(stickFrom(-30, 30, 50), LEFT | DOWN);
  assert.equal(stickFrom(-30, -30, 50), LEFT | UP);
  assert.equal(stickFrom(30, -30, 50), RIGHT | UP);
  // A little off an axis is still that axis: the diagonals take an eighth of the circle each.
  assert.equal(stickFrom(40, 14, 50), RIGHT);
  assert.equal(stickFrom(40, 18, 50), RIGHT | DOWN);
  assert.equal(stickFrom(14, 40, 50), DOWN);
  // Far outside the pad the thumb still steers, and a pad with no size steers nothing.
  assert.equal(stickFrom(-400, 10, 50), LEFT);
  assert.equal(stickFrom(10, 10, 0), 0);
  for (let dx = -60; dx <= 60; dx += 7)
    for (let dy = -60; dy <= 60; dy += 7)
      assert.ok(isInput(stickFrom(dx, dy, 50)), `${dx},${dy} is a stick`);
});

test("a touch stick follows the thumb that took it, captured, until it lifts", () => {
  const pad = new FakePad(),
    seen: number[] = [];
  bindStick(pad, (bits) => seen.push(bits));
  assert.equal(pad.fire("move", 1, 40, 0), 0, "a hover is nobody's");
  assert.equal(pad.fire("down", 1, 40, 0), 1);
  assert.deepEqual(pad.captured, [1]);
  assert.deepEqual(pad.shown.at(-1), { held: true, x: 0.8, y: 0 });
  pad.fire("down", 2, -40, 0);
  pad.fire("move", 2, -40, 0);
  pad.fire("up", 2);
  assert.deepEqual(seen, [RIGHT], "a second thumb does not take the stick");
  // Sliding off the pad keeps steering, with the knob held at the rim.
  assert.equal(pad.fire("move", 1, 30, 90), 1);
  assert.deepEqual(pad.shown.at(-1), { held: true, x: 0.6, y: 1 });
  pad.fire("move", 1, 2, 3);
  pad.fire("up", 1);
  pad.fire("up", 1);
  assert.deepEqual(seen, [RIGHT, DOWN, 0, 0]);
  assert.deepEqual(pad.shown.at(-1), { held: false, x: 0, y: 0 });
  // The pad is free again, and a pointer that cannot be captured still steers.
  pad.refuseCapture = true;
  pad.fire("down", 3, 0, -40);
  assert.equal(seen.at(-1), UP);
  assert.deepEqual(pad.captured, [1]);
});

test("a touch button holds while any thumb is on it", () => {
  const pad = new FakePad(),
    seen: number[] = [];
  bindButton(pad, BTN, (bits) => seen.push(bits));
  pad.fire("up", 9);
  assert.equal(pad.fire("down", 1), 1);
  pad.fire("down", 2);
  pad.fire("up", 1);
  assert.deepEqual(seen, [BTN, BTN], "the other thumb still holds it");
  pad.fire("up", 2);
  pad.fire("up", 2);
  assert.deepEqual(seen, [BTN, BTN, 0]);
  assert.deepEqual(pad.captured, [1, 2]);
  assert.deepEqual(
    pad.shown.map((state) => state.held),
    [true, true, false],
  );
  pad.refuseCapture = true;
  pad.fire("down", 3);
  assert.equal(seen.at(-1), BTN);
});

test("pads hidden under a thumb let go of it, and the next touch is theirs", () => {
  const seen: number[] = [],
    controls = new HeldControls((bits) => seen.push(bits)),
    stick = new FakePad(),
    jump = new FakePad(),
    set = new PadSet(controls);
  set.add(bindStick(stick, (bits) => controls.hold("stick", bits)));
  set.add(bindButton(jump, BTN, (bits) => controls.hold("jump", bits)));
  set.show(false);
  set.show(true);
  stick.fire("down", 1, 40, 0);
  jump.fire("down", 2);
  controls.hold("autopilot", DOWN);
  assert.equal(controls.bits, RIGHT | BTN | DOWN);
  set.show(true);
  assert.equal(controls.bits, RIGHT | BTN | DOWN, "still on screen");
  // The match ends mid-press: the pads go, and the lifts never arrive.
  set.show(false);
  assert.equal(controls.bits, 0);
  assert.equal(seen.at(-1), 0);
  assert.deepEqual(stick.shown.at(-1), { held: false, x: 0, y: 0 });
  assert.deepEqual(jump.shown.at(-1), { held: false, x: 0, y: 0 });
  set.show(false);
  // Back for the next match: another thumb takes the stick at once, and the old one's late lift is nobody's.
  set.show(true);
  stick.fire("down", 5, -40, 0);
  assert.equal(controls.bits, LEFT);
  stick.fire("up", 1);
  assert.equal(controls.bits, LEFT);
  jump.fire("up", 2);
  jump.fire("down", 6);
  assert.equal(controls.bits, LEFT | BTN);
  jump.fire("up", 6);
  stick.fire("up", 5);
  assert.equal(controls.bits, 0);
});

test("the autopilot holds the bot's answer only while a match is running", () => {
  const world = playing();
  ballAt(world, 400, 300);
  const [mine] = world.riders;
  let bits = 0;
  // Somewhere in a second of play the bot holds something.
  for (let i = 0; i < 120 && !bits; i++) {
    stepWorld(world, new Map());
    bits = autopilotBits({ stage: "running", world }, mine.id);
  }
  assert.notEqual(bits, 0);
  assert.equal(bits, botInput(world, mine));
  assert.equal(autopilotBits({ stage: "over", world }, mine.id), 0);
  assert.equal(autopilotBits({ stage: "lobby", world: undefined }, mine.id), 0);
  assert.equal(autopilotBits({ stage: "running", world }, "nobody"), 0);
  assert.equal(autopilotBits(undefined, mine.id), 0);
  // Held through the controls like a thumb, and let go the same way when the match is over.
  const controls = new HeldControls(() => {});
  controls.hold("autopilot", bits);
  assert.equal(controls.bits, bits);
  controls.hold("autopilot", autopilotBits({ stage: "over", world }, mine.id));
  assert.equal(controls.bits, 0);
});
