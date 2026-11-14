import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMATS,
  JUMP,
  LEFT,
  RIGHT,
  STEPS_PER_TICK,
  createWorld,
  stepWorld,
  toView,
  type Format,
  type World,
  type WorldView,
} from "../src/engine/index.js";
import { blobsFor } from "../src/engine/court.js";
import {
  DECAY_MS,
  MAX_AHEAD,
  blendViews,
  copyWorld,
  createCueLatch,
  createSmoother,
  forward,
  forwardInputs,
  memoBot,
  type ForwardInputs,
} from "../src/app/forward.js";
import type { BotInput } from "../src/online/game.js";
import { fresh, rally, steps } from "./fixtures/world.js";
import { started } from "./fixtures/room.js";

/** A match in `format` with its first serve hovering. */
const match = (format: Format): World =>
  createWorld(
    Array.from({ length: blobsFor(format) }, (_, slot) => `p${slot}`),
    "rally",
    1234,
    format,
  );

/** Slot 0 holds `local`, every other blob `others`. */
const holding = (local: number, others = 0): ForwardInputs => ({
  held: (_, slot) => (slot === 0 ? local : others),
});

/** One log tick as the fold runs it. */
function tick(world: World, local: number, others = 0): void {
  const held = world.blobs.map((_, slot) => (slot === 0 ? local : others));
  for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(world, held);
}

for (const format of FORMATS) {
  test(`${format}: a whole tick played forward is the tick the fold produces, the ball with it, and the room's world is left alone`, () => {
    const world = match(format);
    tick(world, RIGHT);
    // The shared ball in flight over the left half.
    rally(world, 200, 260, 40, -20);
    const before = JSON.stringify(world);
    const drawn = forward(world, 1, holding(RIGHT, JUMP));
    assert.equal(
      JSON.stringify(world),
      before,
      "the forward run works on a copy",
    );
    const expected = copyWorld(world);
    tick(expected, RIGHT, JUMP);
    assert.deepEqual(drawn, toView(expected));
    assert.notEqual(drawn.ball.x, toView(world).ball.x, "the ball moved on");
    // Two ticks ahead, while the fold is late, is the tick after that.
    tick(expected, RIGHT, JUMP);
    assert.deepEqual(forward(world, 2, holding(RIGHT, JUMP)), toView(expected));
    assert.deepEqual(forward(world, 0, holding(0)), toView(world));
    assert.deepEqual(
      forward(world, 9, holding(0)),
      forward(world, 2, holding(0)),
      "never further than two log ticks",
    );
  });

  test(`${format}: a press shows on the local blob at once, part of the way into the tick, and on no one else`, () => {
    const world = match(format);
    tick(world, 0);
    const still = forward(world, 0.5, holding(0)),
      pressed = forward(world, 0.5, holding(LEFT));
    assert.ok(
      pressed.blobs[0]!.x < still.blobs[0]!.x,
      "the blob holding left is already moving left",
    );
    for (let slot = 1; slot < world.blobs.length; slot++)
      assert.equal(pressed.blobs[slot]!.x, still.blobs[slot]!.x);
  });

  test(`${format}: the end of a rally is never shown before the room folds it`, () => {
    const world = match(format);
    // The ball about to land on the left half.
    rally(world, 140, 40, 0, -400);
    const drawn = forward(world, 2, holding(0));
    assert.equal(drawn.phase, "rally");
    assert.equal(drawn.pointCounter, world.pointCounter);
    assert.deepEqual(drawn.score, world.score);
    assert.deepEqual(drawn.points, world.points);
    const folded = copyWorld(world);
    tick(folded, 0);
    tick(folded, 0);
    assert.notEqual(
      folded.pointCounter,
      world.pointCounter,
      "the fold does end the rally",
    );
  });
}

test("a touch that puts a hovering serve in play is shown at once", () => {
  // The server jumps where it stands until a tick of it touches the hovering ball: the last folded world before that.
  let folded = fresh();
  const server = folded.server,
    jump = (world: World) => {
      const held = world.blobs.map((_, slot) => (slot === server ? JUMP : 0));
      for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(world, held);
    };
  for (let i = 0; i < 200; i++) {
    const next = copyWorld(folded);
    jump(next);
    if (next.phase !== "serve") break;
    folded = next;
  }
  const confirmed = copyWorld(folded);
  jump(confirmed);
  assert.equal(confirmed.phase, "rally", "the server's jump does touch it");
  const drawn = forward(folded, 1, {
    held: (_, slot) => (slot === server ? JUMP : 0),
  });
  assert.deepEqual(drawn, toView(confirmed));
});

test("a fraction of a step is drawn between the two steps either side", () => {
  const world = rally(fresh(), 300, 300, 64, 0);
  const step = 1 / STEPS_PER_TICK;
  const a = forward(world, 2 * step, holding(0)),
    b = forward(world, 3 * step, holding(0)),
    half = forward(world, 2.5 * step, holding(0));
  assert.ok(Math.abs(half.ball.x - (a.ball.x + b.ball.x) / 2) < 1e-6);
  assert.deepEqual(half.score, a.score);
  assert.equal(MAX_AHEAD, 2 * STEPS_PER_TICK);
  // A new serve is never smeared across.
  const served = { ...b, phase: "serve" as const };
  assert.equal(blendViews(a, served, 0.5), a);
  assert.equal(blendViews(a, b, 0), a);
  assert.equal(blendViews(a, b, 1), b);
});

test("the forward run plays a bot as the fold would, a human as last logged and this device live", () => {
  const room = started();
  room.held = { a: RIGHT, b: JUMP };
  const asked: number[] = [];
  const bot: BotInput = (_world, slot) => {
    asked.push(slot);
    return JUMP;
  };
  const world = room.world!;
  const fromA = forwardInputs(room, "a", LEFT, bot),
    fromB = forwardInputs(room, "b", 0, bot);
  assert.equal(fromA.held(world, 0), LEFT, "this device's own live bits");
  assert.equal(fromA.held(world, 1), JUMP, "the other as last logged");
  assert.equal(fromB.held(world, 0), RIGHT);
  room.seats.get("b")!.connected = false;
  assert.equal(fromA.held(world, 1), 0, "an absent player holds nothing");
  room.seats.get("b")!.bot = true;
  assert.equal(fromA.held(world, 1), JUMP);
  assert.deepEqual(asked, [1]);
});

test("the drawn bot plans once per revision, step and blob", () => {
  let plans = 0;
  const memo = memoBot((_world, slot) => {
    plans++;
    return slot === 0 ? RIGHT : JUMP;
  });
  const world = fresh();
  assert.equal(memo(1)(world, 0, 2), RIGHT);
  assert.equal(memo(1)(world, 0, 2), RIGHT);
  assert.equal(memo(1)(world, 1, 2), JUMP);
  assert.equal(plans, 2);
  steps(world, 1);
  memo(1)(world, 0, 2);
  assert.equal(plans, 3);
  memo(2)(world, 0, 2);
  assert.equal(plans, 4, "a rollback asks again");
});

test("a predicted touch is not heard twice when the next picture takes it back and the fold confirms it", () => {
  const latch = createCueLatch();
  const base = toView(rally(fresh(), 300, 200, 0, 0));
  const at = (hits: number, floors = base.floorCounter): WorldView => ({
    ...base,
    hitCounter: hits,
    floorCounter: floors,
  });
  assert.equal(latch(at(4), "m1").hitCounter, 4);
  assert.equal(latch(at(5), "m1").hitCounter, 5, "the predicted touch");
  assert.equal(latch(at(4), "m1").hitCounter, 5, "taken back: still shown");
  assert.equal(latch(at(5), "m1").hitCounter, 5, "confirmed: no new count");
  assert.equal(latch(at(6), "m1").hitCounter, 6, "the next touch counts");
  assert.equal(
    latch(at(0xffff), "m1").hitCounter,
    6,
    "a count never goes back",
  );
  assert.equal(latch(at(2), "m2").hitCounter, 2, "a new match starts over");
  const same = at(2);
  assert.equal(latch(same, "m2"), same, "nothing latched: the view as it is");
});

const shifted = (view: WorldView, dx: number): WorldView => ({
  ...view,
  ball: { ...view.ball, x: view.ball.x + dx },
  blobs: view.blobs.map((blob) => ({ ...blob, x: blob.x + dx })),
});

test("a rollback correction eases in, the local blob never does, and a teleport is shown as it is", () => {
  const smoother = createSmoother();
  const base = toView(rally(fresh(), 300, 200, 0, 0));
  const held = [0, 0];
  // Three still frames: the smoother learns where things are and that they are not moving.
  for (const t of [0, 10, 20])
    assert.equal(smoother.apply(base, 1, 6, held, t, 0).ball.x, base.ball.x);
  const corrected = shifted(base, 20);
  const first = smoother.apply(corrected, 2, 6, held, 30, 0);
  assert.equal(first.ball.x, base.ball.x, "drawn where it was");
  assert.equal(
    first.blobs[0]!.x,
    corrected.blobs[0]!.x,
    "the local blob follows its player exactly",
  );
  assert.equal(first.blobs[1]!.x, base.blobs[1]!.x);
  const later = smoother.apply(corrected, 2, 6, held, 30 + DECAY_MS, 0);
  assert.ok(Math.abs(later.ball.x - (corrected.ball.x - 20 / Math.E)) < 0.01);
  const settled = smoother.apply(corrected, 2, 6, held, 30 + DECAY_MS * 20, 0);
  assert.equal(settled.ball.x, corrected.ball.x);
  const far = shifted(corrected, 300);
  assert.equal(
    smoother.apply(far, 3, 6, held, 40 + DECAY_MS * 20, 0).ball.x,
    far.ball.x,
  );
});

test("another player's changed controls ease their blob, not the ball, and unchanged ones are drawn as they are", () => {
  const smoother = createSmoother();
  const base = toView(rally(fresh(), 300, 200, 0, 0));
  for (const t of [0, 10, 20]) smoother.apply(base, 1, 6, [0, 0], t, 0);
  // A new tick folded with no rollback: blob 1's logged controls did not change, so a jump is drawn as it is.
  const moved = shifted(base, 10);
  const same = smoother.apply(moved, 1, 12, [0, 0], 30, 0);
  assert.equal(same.blobs[1]!.x, moved.blobs[1]!.x);
  assert.equal(same.ball.x, moved.ball.x);
  // The next tick shows blob 1 changed what it holds: its jump off the expected path is eased, the ball's is not.
  const again = shifted(moved, 40);
  const eased = smoother.apply(again, 1, 18, [0, RIGHT], 40, 0);
  assert.ok(eased.blobs[1]!.x < again.blobs[1]!.x, "eased in");
  assert.equal(eased.ball.x, again.ball.x);
  assert.equal(eased.blobs[0]!.x, again.blobs[0]!.x, "never the local blob");
});

test("a new serve starts the smoother over", () => {
  const smoother = createSmoother();
  const world = rally(fresh(), 300, 200, 0, 0);
  const base = toView(world);
  for (const t of [0, 10, 20]) smoother.apply(base, 1, 6, [0, 0], t, 0);
  const served: WorldView = {
    ...shifted(base, 50),
    phase: "serve",
    pointCounter: base.pointCounter + 1,
  };
  const drawn = smoother.apply(served, 2, 12, [0, 0], 30, 0);
  assert.equal(drawn.ball.x, served.ball.x);
  assert.equal(drawn.blobs[1]!.x, served.blobs[1]!.x);
});
