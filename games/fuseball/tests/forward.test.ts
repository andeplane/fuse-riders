import test from "node:test";
import assert from "node:assert/strict";
import {
  RIGHT,
  STEPS_PER_TICK,
  copyWorld,
  mapOf,
  paceTick,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import {
  createCueLatch,
  createSmoother,
  forward,
  memoBot,
  type ForwardInputs,
} from "../src/app/forward.js";
import { A, B, ballAt, held, place, playing } from "./fixtures/world.js";

const holding = (a: number, b = 0): ForwardInputs => ({
  held: (_, rider) => (rider.id === A ? a : b),
});

/** One log tick as the fold runs it. */
function tick(world: World, a: number, b = 0): void {
  for (let left = paceTick(world); left > 0; left--)
    stepWorld(world, held(a, b));
}

test("a whole tick played forward is the tick the fold produces, and the room's world is left alone", () => {
  const world = playing();
  tick(world, RIGHT);
  const before = JSON.stringify(world);
  const drawn = forward(world, 1, holding(RIGHT));
  assert.equal(
    JSON.stringify(world),
    before,
    "the forward run works on a copy",
  );
  tick(world, RIGHT);
  assert.deepEqual(drawn, toView(world));
  // Two ticks ahead, while the fold is late, is the tick after that.
  const two = forward(world, 2, holding(RIGHT));
  tick(world, RIGHT);
  tick(world, RIGHT);
  assert.deepEqual(two, toView(world));
});

test("a press shows on the local rider at once, part of the way into the tick", () => {
  const world = playing();
  tick(world, 0);
  const still = forward(world, 0.5, holding(0)),
    pressed = forward(world, 0.5, holding(RIGHT));
  assert.ok(
    pressed.riders[0].x > still.riders[0].x,
    "the rider holding right is already moving right",
  );
  assert.equal(pressed.riders[1].x, still.riders[1].x);
  // Half a tick is three of its six steps; a fraction of a step is blended.
  const three = copyWorld(world);
  paceTick(three);
  for (let i = 0; i < STEPS_PER_TICK / 2; i++) stepWorld(three, held(RIGHT));
  assert.deepEqual(pressed, toView(three));
  const between = forward(world, 3.5 / STEPS_PER_TICK, holding(RIGHT));
  const four = copyWorld(three);
  stepWorld(four, held(RIGHT));
  assert.ok(
    between.riders[0].x > toView(three).riders[0].x &&
      between.riders[0].x < toView(four).riders[0].x,
  );
  assert.deepEqual(forward(world, 0, holding(RIGHT)), toView(world));
});

test("the forward run never shows a goal the room has not folded", () => {
  const world = playing();
  const goal = mapOf(world.mapId).goals.find((each) => each.team === 0)!;
  // The ball a step or two short of a goal, flying in.
  const y = "r" in goal ? goal.y : goal.y + goal.h / 2,
    edge = "r" in goal ? goal.x : goal.x < 100 ? goal.x + goal.w : goal.x,
    inward = edge < 100 ? -1 : 1;
  ballAt(world, edge - inward * 14, y, inward * 6, 0);
  place(world, 0, 320, 100);
  place(world, 1, 320, 100);
  const scored = copyWorld(world);
  tick(scored, 0);
  assert.notDeepEqual(scored.score, world.score, "the fold scores this tick");
  const drawn = forward(world, 1, holding(0));
  assert.deepEqual(drawn.score, toView(world).score);
  assert.equal(drawn.phase, "play");
  assert.ok(
    drawn.step > world.step,
    "it still played the steps before the goal",
  );
});

test("a bot is asked once per folded world and revision, however many frames draw it", () => {
  let asked = 0;
  const memo = memoBot(() => {
    asked++;
    return RIGHT;
  });
  const world = playing();
  const inputs = (revision: number): ForwardInputs => ({
    held: (copy, rider) => (rider.id === B ? memo(revision)(copy, rider) : 0),
  });
  for (let frame = 0; frame < 5; frame++)
    forward(world, 0.2 * frame, inputs(0));
  assert.equal(asked, 1);
  // Late-fold frames play into a second tick: one more answer, not one per frame.
  for (let frame = 0; frame < 5; frame++)
    forward(world, 1.2 + 0.1 * frame, inputs(0));
  assert.equal(asked, 2);
  // A rollback replaced the world at the same step: its answer is asked for again.
  forward(world, 0.5, inputs(1));
  assert.equal(asked, 3);
  tick(world, 0);
  forward(world, 0.5, inputs(1));
  assert.equal(asked, 4);
});

test("a count the forward run showed and took back is not counted twice when the room folds it", () => {
  const latch = createCueLatch();
  const base = toView(playing());
  const withCounts = (jumps: number, bounces: number) =>
    ({
      ...base,
      riders: base.riders.map((rider) =>
        rider.index === 1 ? { ...rider, jumps } : rider,
      ),
      ball: { ...base.ball, bounces },
    }) as typeof base;
  assert.equal(latch(base, "m1"), base, "an untouched view is passed through");
  const predicted = latch(withCounts(1, 1), "m1");
  assert.equal(predicted.riders[1].jumps, 1);
  // The next forward run takes both back: the scene keeps seeing what it already played.
  const reverted = latch(withCounts(0, 0), "m1");
  assert.equal(reverted.riders[1].jumps, 1);
  assert.equal(reverted.ball.bounces, 1);
  // The room folds them: nothing new to play. The next one counts.
  assert.equal(latch(withCounts(1, 1), "m1").riders[1].jumps, 1);
  assert.equal(latch(withCounts(2, 1), "m1").riders[1].jumps, 2);
  // Counters wrap at 65536 and start again with a new match.
  assert.equal(latch(withCounts(65535, 1), "m2").riders[1].jumps, 65535);
  assert.equal(latch(withCounts(0, 1), "m2").riders[1].jumps, 0);
  assert.equal(latch(withCounts(0, 0), "m3").ball.bounces, 0);
});

test("the smoother hides a correction to the other rider and the ball, and never touches the local rider", () => {
  const world = playing();
  tick(world, 0);
  const smoother = createSmoother();
  let now = 0;
  const show = (view = toView(world), revision = 0, held = [0, 0]) =>
    smoother.apply(view, revision, view.step, held, (now += 16), 0);
  for (let i = 0; i < 3; i++) show();
  const base = toView(world);
  const moved = {
    ...base,
    riders: base.riders.map((rider) => ({ ...rider, x: rider.x + 20 })),
    ball: { ...base.ball, x: base.ball.x + 20 },
  } as typeof base;
  // A rollback moved everything 20 px: the local rider snaps, the others start from where they were.
  const after = show(moved, 1);
  assert.equal(after.riders[0].x, moved.riders[0].x);
  assert.ok(Math.abs(after.riders[1].x - base.riders[1].x) < 1e-6);
  assert.ok(Math.abs(after.ball.x - base.ball.x) < 1e-6);
  let last = after;
  for (let i = 0; i < 30; i++) last = show(moved, 1);
  assert.equal(last.riders[1].x, moved.riders[1].x);
  assert.equal(last.ball.x, moved.ball.x);
  // A new tick where the other rider moved as drawn changes nothing; one where their controls changed is absorbed.
  const next = {
    ...moved,
    step: moved.step + 6,
    riders: moved.riders.map((rider) => ({ ...rider, x: rider.x + 9 })),
  } as typeof base;
  assert.equal(show(next, 1).riders[1].x, next.riders[1].x);
  const turned = {
    ...next,
    step: next.step + 6,
    riders: next.riders.map((rider) => ({ ...rider, x: rider.x + 30 })),
  } as typeof base;
  const hidden = show(turned, 1, [0, RIGHT]);
  assert.ok(
    hidden.riders[1].x < turned.riders[1].x &&
      hidden.riders[1].x >= next.riders[1].x,
    "the other rider is eased towards where their new controls put them",
  );
  assert.equal(hidden.riders[0].x, turned.riders[0].x);
  // A point reset is a teleport by design.
  const reset = { ...turned, score: [1, 0] as [number, number] };
  const fresh = show(
    {
      ...reset,
      ball: { ...reset.ball, x: reset.ball.x - 60 },
    },
    2,
  );
  assert.equal(fresh.ball.x, reset.ball.x - 60);
});
