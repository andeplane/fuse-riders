import test from "node:test";
import assert from "node:assert/strict";
import { toView } from "../src/engine/view.js";
import {
  RIGHT,
  SHRINES,
  botInput,
  createWorld,
  stepWorld,
  type World,
} from "../src/engine/world.js";
import {
  createSmoother,
  forward,
  memoBot,
  type ForwardInputs,
} from "../src/app/forward.js";

const A = "a",
  B = "b";
const night = (): World =>
  createWorld(7, [
    { id: A, slot: 0 },
    { id: B, slot: 1 },
  ]);
const holding = (a: number, b = 0): ForwardInputs => ({
  held: (_, hunter) => (hunter.id === A ? a : b),
});
const tick = (world: World, a: number, b = 0) =>
  stepWorld(
    world,
    new Map([
      [A, a],
      [B, b],
    ]),
  );

test("a whole tick played forward is the tick the fold produces, and the room's world is left alone", () => {
  const world = night();
  tick(world, RIGHT);
  const before = JSON.stringify(world);
  const drawn = forward(world, 1, holding(RIGHT));
  assert.equal(JSON.stringify(world), before, "the run works on a copy");
  tick(world, RIGHT);
  assert.deepEqual(drawn, toView(world));
  const two = forward(world, 2, holding(RIGHT));
  tick(world, RIGHT);
  tick(world, RIGHT);
  assert.deepEqual(two, toView(world));
});

test("a press shows on the local hunter at once, part of the way into the tick", () => {
  const world = night();
  tick(world, 0);
  const still = forward(world, 0.5, holding(0)),
    pressed = forward(world, 0.5, holding(RIGHT)),
    from = world.hunters[0]!.x;
  assert.equal(still.hunters[0]!.x, from);
  // Half a tick of a 6 px step.
  assert.equal(pressed.hunters[0]!.x, from + 3);
  assert.equal(pressed.hunters[1]!.x, still.hunters[1]!.x);
  assert.equal(pressed.tick, world.tick + 1, "the rest is the step's own");
});

test("energy banked at a shrine is never shown before the room folds it", () => {
  const world = night(),
    hunter = world.hunters[0]!,
    shrine = SHRINES[0]!;
  hunter.x = shrine.x;
  hunter.y = shrine.y;
  world.ghosts.push({
    id: 99,
    kind: 1,
    x: 0,
    y: 0,
    resistance: 0,
    emerge: 0,
    tug: 0,
    claim: [0, 0, 0, 0, 0],
    carrier: A,
  });
  hunter.tank = [99];
  hunter.deposit = 23;
  // The next step counts to 24; the one after banks.
  const drawn = forward(world, 2, holding(0));
  assert.equal(drawn.tick, world.tick + 1);
  assert.equal(drawn.hunters[0]!.score, 0);
  assert.deepEqual(drawn.hunters[0]!.tank, [99]);
  // Part of the way into the banking step shows nothing of it either.
  const part = forward(world, 1.5, holding(0));
  assert.equal(part.hunters[0]!.score, 0);
  assert.equal(part.tick, world.tick + 1);
});

test("a bot is asked once per hunter, tick and revision", () => {
  const world = night();
  let asked = 0;
  const bot = memoBot((w, h) => {
    asked++;
    return botInput(w, h);
  });
  const inputs = (revision: number): ForwardInputs => ({
    held: (w, h) => (h.id === B ? bot(revision)(w, h) : 0),
  });
  forward(world, 0.3, inputs(1));
  forward(world, 0.6, inputs(1));
  assert.equal(asked, 1);
  forward(world, 0.6, inputs(2));
  assert.equal(asked, 2, "a rollback replaced the world: ask again");
});

test("a correction to another hunter is spread over a few frames; this device's own never is", () => {
  const smoother = createSmoother(),
    world = night();
  const at = (x: number, mine: number) => {
    const view = toView(world);
    view.hunters[0]!.x = mine;
    view.hunters[1]!.x = x;
    return view;
  };
  const key = "m:1";
  // Two frames moving at 2 px a frame, then a rollback puts the other hunter 30 px away.
  smoother.apply(at(500, 100), key, 1, 10, {}, 0, A);
  smoother.apply(at(502, 100), key, 1, 10, {}, 16, A);
  const jumped = smoother.apply(at(534, 140), key, 2, 10, {}, 32, A);
  assert.equal(jumped.hunters[0]!.x, 140, "the local hunter follows the hands");
  assert.ok(
    Math.abs(jumped.hunters[1]!.x - 504) < 0.01,
    "the other hunter carries on from where it was drawn",
  );
  const later = smoother.apply(at(536, 140), key, 2, 10, {}, 48, A);
  assert.ok(later.hunters[1]!.x > 506 && later.hunters[1]!.x < 536);
  let last = later;
  for (let ms = 64; ms < 600; ms += 16)
    last = smoother.apply(at(536, 140), key, 2, 10, {}, ms, A);
  assert.equal(last.hunters[1]!.x, 536, "and ends where the room has it");
  // The same jump with no rollback and no change of controls is the picture's own: shown as it is.
  const plain = smoother.apply(at(566, 140), key, 2, 10, {}, 616, A);
  assert.equal(plain.hunters[1]!.x, 566);
  // A new tick on which the other hunter's logged controls changed is a wrong guess too.
  smoother.apply(at(568, 140), key, 2, 10, {}, 632, A);
  const turned = smoother.apply(at(540, 140), key, 2, 11, { [B]: 4 }, 648, A);
  assert.ok(turned.hunters[1]!.x > 560);
});
