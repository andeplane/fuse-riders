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

test("a bot is asked once per folded world, however many frames draw it", () => {
  let asked = 0;
  const bot = memoBot(() => {
    asked++;
    return RIGHT;
  });
  const world = playing();
  const inputs: ForwardInputs = {
    held: (copy, rider) => (rider.id === B ? bot(copy, rider) : 0),
  };
  for (let frame = 0; frame < 5; frame++) forward(world, 0.2 * frame, inputs);
  assert.equal(asked, 1);
  tick(world, 0);
  forward(world, 0.5, inputs);
  assert.equal(asked, 2);
});

test("the smoother hides a correction to the other rider and the ball, and never touches the local rider", () => {
  const world = playing();
  tick(world, 0);
  const smoother = createSmoother();
  let now = 0;
  const show = (view = toView(world), revision = 0) =>
    smoother.apply(view, revision, view.step, (now += 16), 0);
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
  // A point reset is a teleport by design.
  const reset = { ...moved, score: [1, 0] as [number, number] };
  const fresh = show(
    {
      ...reset,
      ball: { ...reset.ball, x: reset.ball.x - 60 },
    },
    2,
  );
  assert.equal(fresh.ball.x, reset.ball.x - 60);
});
