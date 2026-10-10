import test from "node:test";
import assert from "node:assert/strict";
import { HeldControls } from "../src/app/controls.js";
import {
  DPad,
  PAD_BUTTONS,
  PAD_DEAD_ZONE,
  directionBits,
  directionName,
  padButtons,
  type PadEvent,
  type PadPointer,
  type PadSurface,
} from "../src/app/pad.js";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  UP,
  createWorld,
  step,
} from "../src/engine/index.js";

/** A d-pad's element: 200 × 200 CSS px at (100, 50), so its centre is (200, 150) and its radius 100. */
class FakeSurface implements PadSurface {
  readonly listeners = new Map<PadEvent, ((event: PadPointer) => void)[]>();
  readonly captured: number[] = [];
  refuseCapture = false;
  box = { left: 100, top: 50, width: 200, height: 200 };
  addEventListener(type: PadEvent, listener: (event: PadPointer) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  getBoundingClientRect() {
    return this.box;
  }
  setPointerCapture(pointerId: number) {
    if (this.refuseCapture) throw new Error("InvalidStateError");
    this.captured.push(pointerId);
  }
  /** Fires `type` for pointer `id` at (`dx`, `dy`) from the pad's centre; true if the page's default was cancelled. */
  fire(type: PadEvent, id: number, dx = 0, dy = 0, button = 0): boolean {
    let cancelled = false;
    for (const listener of this.listeners.get(type) ?? [])
      listener({
        pointerId: id,
        clientX: 200 + dx,
        clientY: 150 + dy,
        button,
        preventDefault: () => {
          cancelled = true;
        },
      });
    return cancelled;
  }
}

/** A d-pad on a fake element, recording every change of bits it holds. */
function pad() {
  const surface = new FakeSurface(),
    holds: number[] = [];
  const dpad = new DPad(surface, (bits) => holds.push(bits));
  return { surface, holds, dpad };
}

const EIGHT: readonly (readonly [string, number, number, number])[] = [
  ["right", 1, 0, RIGHT],
  ["down-right", 1, 1, DOWN | RIGHT],
  ["down", 0, 1, DOWN],
  ["down-left", -1, 1, DOWN | LEFT],
  ["left", -1, 0, LEFT],
  ["up-left", -1, -1, UP | LEFT],
  ["up", 0, -1, UP],
  ["up-right", 1, -1, UP | RIGHT],
];

test("the d-pad's directions: 8 sectors of 45°, nothing in the dead zone, a lean past the edge steers on", () => {
  for (const [name, x, y, bits] of EIGHT) {
    const length = Math.hypot(x, y);
    assert.equal(directionBits(x / length, y / length, 0.25), bits, name);
    assert.equal(
      directionBits(x * 3, y * 3, 0.25),
      bits,
      `${name} off the pad`,
    );
  }
  // Each sector is 45° wide, centred on its direction: 22° off an axis is still straight, 23° is the diagonal.
  const at = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return directionBits(Math.cos(radians), Math.sin(radians), 0.25);
  };
  assert.equal(at(22), RIGHT);
  assert.equal(at(23), DOWN | RIGHT);
  assert.equal(at(-67), UP | RIGHT);
  assert.equal(at(-68), UP);
  assert.equal(directionBits(0.2, 0.1, 0.25), 0, "inside the dead zone");
  assert.equal(directionBits(0.25, 0, 0.25), 0, "on its edge");
  assert.equal(directionBits(0.26, 0, 0.25), RIGHT);
  assert.equal(directionBits(Number.NaN, 1, 0.25), 0);
  assert.equal(directionBits(1, Number.POSITIVE_INFINITY, 0.25), 0);
  assert.equal(directionName(UP | LEFT), "up left");
  assert.equal(directionName(DOWN | RIGHT | ATTACK), "down right");
  assert.equal(directionName(0), "");
});

test("a thumb on the d-pad steers from where it is against the pad's centre, 8 ways, and lets go when it lifts", () => {
  for (const [name, x, y, bits] of EIGHT) {
    const { surface, holds, dpad } = pad();
    assert.ok(surface.fire("pointerdown", 1, x * 70, y * 70), "no scroll");
    assert.deepEqual(holds, [bits], name);
    assert.deepEqual(surface.captured, [1], "a slide off the pad steers on");
    assert.equal(dpad.bits, bits);
    surface.fire("pointerup", 1, x * 70, y * 70);
    assert.deepEqual(holds, [bits, 0], name);
  }
  // A press in the dead zone holds nothing until the thumb leans out of it.
  const { surface, holds } = pad();
  surface.fire("pointerdown", 1, 10, -10);
  assert.deepEqual(holds, []);
  surface.fire("pointermove", 1, 100 * PAD_DEAD_ZONE + 5, 0);
  assert.deepEqual(holds, [RIGHT]);
});

test("sliding round the d-pad walks the diagonals, and back through the centre lets go", () => {
  const { surface, holds } = pad();
  surface.fire("pointerdown", 1, 80, 0);
  surface.fire("pointermove", 1, 80, 5, 0); // still right: no change is heard
  surface.fire("pointermove", 1, 60, 60);
  surface.fire("pointermove", 1, 0, 80);
  surface.fire("pointermove", 1, -60, 60);
  surface.fire("pointermove", 1, -80, 0);
  surface.fire("pointermove", 1, 0, 0);
  surface.fire("pointermove", 1, 0, -250); // far above the pad: still up
  assert.deepEqual(holds, [
    RIGHT,
    DOWN | RIGHT,
    DOWN,
    DOWN | LEFT,
    LEFT,
    0,
    UP,
  ]);
});

test("a double tap of the d-pad, lifted or slid through the centre, is the press, release, press the engine reads as a run", () => {
  for (const [how, gap] of [
    ["lifted", (surface: FakeSurface) => surface.fire("pointerup", 1, 80, 0)],
    ["slid", (surface: FakeSurface) => surface.fire("pointermove", 1, 5, 5)],
  ] as const) {
    const sent: number[] = [];
    const controls = new HeldControls((bits) => sent.push(bits));
    const surface = new FakeSurface();
    new DPad(surface, (bits) => controls.hold("dpad", bits));
    surface.fire("pointerdown", 1, 80, 0);
    gap(surface);
    if (how === "lifted") surface.fire("pointerdown", 2, 75, 10);
    else surface.fire("pointermove", 1, 75, 10);
    assert.deepEqual(sent, [RIGHT, 0, RIGHT], how);
    // The engine, fed each change for a log tick (three steps), runs the hero right; a single tap walks.
    const played = (changes: readonly number[]) =>
      changes
        .flatMap((bits) => [bits, bits, bits])
        .reduce(
          (world, bits) => step(world, [bits]),
          createWorld({ seed: 1, heroes: [{ seat: 0, kind: "brakka" }] }),
        ).heroes[0]!.state;
    assert.equal(played(sent), "run", how);
    assert.equal(played([RIGHT, 0, 0]), "idle", how);
    assert.equal(played([RIGHT, RIGHT, RIGHT]), "walk", how);
  }
});

test("one thumb steers: a second finger, another pointer's moves and lifts, and a right click change nothing", () => {
  const { surface, holds } = pad();
  surface.fire("pointerdown", 1, -80, 0);
  surface.fire("pointerdown", 2, 80, 0);
  surface.fire("pointermove", 2, 0, 80);
  surface.fire("pointerup", 2, 0, 80);
  surface.fire("pointercancel", 2);
  assert.deepEqual(holds, [LEFT]);
  surface.fire("pointerup", 1);
  surface.fire("pointerdown", 3, 0, 80, 2);
  assert.deepEqual(holds, [LEFT, 0], "a right click is not a press");
  surface.fire("pointermove", 1, 80, 0);
  assert.deepEqual(holds, [LEFT, 0], "a lifted thumb's moves are not heard");
});

test("the d-pad lets go when the browser cancels the touch, takes its capture away, or the page loses focus", () => {
  for (const type of ["pointercancel", "lostpointercapture"] as const) {
    const { surface, holds } = pad();
    surface.fire("pointerdown", 1, 0, -80);
    surface.fire(type, 1);
    assert.deepEqual(holds, [UP, 0], type);
  }
  // Blur or a hidden page: the page cancels the pad and clears the controls; the thumb still down steers no more.
  const sent: number[] = [];
  const controls = new HeldControls((bits) => sent.push(bits));
  const surface = new FakeSurface();
  const dpad = new DPad(surface, (bits) => controls.hold("dpad", bits));
  surface.fire("pointerdown", 1, 0, 80);
  controls.clear();
  dpad.cancel();
  surface.fire("pointermove", 1, 80, 0);
  assert.deepEqual(sent, [DOWN, 0]);
  assert.equal(controls.bits, 0);
  surface.fire("pointerdown", 2, 80, 0);
  assert.deepEqual(sent, [DOWN, 0, RIGHT], "a fresh touch steers again");
});

test("a pointer the browser will not capture still steers; a pad with no size steers nothing", () => {
  const { surface, holds } = pad();
  surface.refuseCapture = true;
  surface.fire("pointerdown", 1, -80, 0);
  assert.deepEqual(holds, [LEFT]);
  const empty = pad();
  empty.surface.box = { left: 0, top: 0, width: 0, height: 0 };
  empty.surface.fire("pointerdown", 1, 80, 0);
  assert.deepEqual(empty.holds, []);
});

test("the pad's buttons hold Attack, Jump and Magic from press to release, two thumbs both, alongside the d-pad", () => {
  assert.deepEqual(
    PAD_BUTTONS.map(({ label, bit }) => [label, bit]),
    [
      ["ATTACK", ATTACK],
      ["JUMP", JUMP],
      ["MAGIC", MAGIC],
    ],
  );
  const sent: number[] = [];
  const controls = new HeldControls((bits) => sent.push(bits));
  const [attack, jump, magic] = padButtons((source, bits) =>
    controls.hold(source, bits),
  );
  assert.deepEqual(
    [attack!.keys, jump!.keys, magic!.keys],
    ["J Z", "K X", "L C"],
    "the keys each stands for",
  );
  const surface = new FakeSurface();
  new DPad(surface, (bits) => controls.hold("dpad", bits));
  surface.fire("pointerdown", 1, 80, 0);
  attack!.onPress!();
  jump!.onPress!();
  attack!.onRelease!();
  magic!.onPress!();
  magic!.onRelease!();
  jump!.onRelease!();
  surface.fire("pointerup", 1);
  assert.deepEqual(sent, [
    RIGHT,
    RIGHT | ATTACK,
    RIGHT | ATTACK | JUMP,
    RIGHT | JUMP,
    RIGHT | JUMP | MAGIC,
    RIGHT | JUMP,
    RIGHT,
    0,
  ]);
  // A button held when the page loses focus is let go with everything else.
  attack!.onPress!();
  controls.clear();
  assert.equal(controls.bits, 0);
  attack!.onRelease!();
  assert.deepEqual(sent.slice(-2), [ATTACK, 0]);
});
