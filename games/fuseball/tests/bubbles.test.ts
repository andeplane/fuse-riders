import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  DOWN,
  LEFT,
  RIGHT,
  mirrored,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import {
  at,
  ballAt,
  held,
  place,
  playing,
  scripted,
  steps,
  until,
} from "./fixtures/world.js";

const RIDER = 9,
  BALL = 8,
  BUBBLE = 14;

/** A world with the ball parked out of the way on the floor, so only what a test puts near a bubble touches it. */
function arena(): World {
  const world = playing();
  ballAt(world, 320, 336);
  return world;
}
const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(at(a.x - b.x), at(a.y - b.y));

/** Slot 0 air-jumps once at `(x, y)` and lets go at once: a normal bubble is left there. */
function bubbleAt(world: World, x: number, y: number): void {
  place(world, 0, x, y);
  stepWorld(world, held(BTN));
  stepWorld(world, held(0));
  // The rider is moved well away so the bubble stands alone.
  place(world, 0, 60, 60);
}

test("an air-jump leaves a bubble where the rider was; a grounded jump and a slide leave none", () => {
  const world = arena(),
    [mine, theirs] = world.bubbles;
  stepWorld(world, held(BTN));
  assert.ok(!mine.active, "the jump off the floor leaves nothing");
  steps(world, 20);
  const { x, y } = world.riders[0];
  stepWorld(world, held(BTN));
  assert.ok(mine.active);
  assert.deepEqual([mine.x, mine.y], [x, y]);
  assert.equal(mine.seq, 1);
  assert.ok(!theirs.active, "the other rider's bubble is their own");

  const sliding = arena();
  stepWorld(sliding, held(DOWN | BTN));
  steps(sliding, 100, held(DOWN | BTN));
  assert.ok(!sliding.bubbles[0].active);
});

test("a quick drop leaves a bubble too", () => {
  const world = arena();
  place(world, 0, 215, 120);
  stepWorld(world, held(DOWN | BTN));
  assert.ok(world.bubbles[0].active);
  assert.equal(at(world.bubbles[0].y), 120);
});

test("a rider has one bubble: the next air-jump moves it", () => {
  const world = arena(),
    bubble = world.bubbles[0];
  place(world, 0, 215, 300);
  stepWorld(world, held(BTN));
  const first = { x: bubble.x, y: bubble.y };
  steps(world, 20);
  stepWorld(world, held(BTN));
  assert.ok(bubble.active);
  assert.equal(bubble.seq, 2);
  assert.ok(bubble.y < first.y, "it is where the rider is now");
  assert.equal(
    world.bubbles.filter((each) => each.active).length,
    1,
    "and the old one is gone",
  );
});

test("each rider keeps their own bubble", () => {
  const world = arena();
  place(world, 0, 215, 300);
  place(world, 1, 425, 300);
  stepWorld(world, held(BTN, BTN));
  assert.ok(world.bubbles[0].active && world.bubbles[1].active);
  assert.equal(at(world.bubbles[0].x), 215);
  assert.equal(at(world.bubbles[1].x), 425);
});

test("a bubble throws the ball away from its centre, then pops", () => {
  for (const [from, vx] of [
    [-60, 2],
    [60, -2],
  ] as const) {
    const world = arena(),
      bubble = world.bubbles[0];
    bubbleAt(world, 320, 100);
    assert.ok(bubble.active && !bubble.hard);
    ballAt(world, 320 + from, 100, vx, 0);
    world.ball.touch = -1;
    const bounces = world.ball.bounces;
    const hit = until(world, () => !bubble.active, new Map(), 60);
    assert.notEqual(hit, -1, "the ball reaches the bubble");
    assert.equal(Math.sign(world.ball.vx), Math.sign(from), "thrown back out");
    assert.ok(Math.abs(world.ball.vx) > SUB / 2, "at a bumper's speed");
    assert.ok(
      distance(world.ball, bubble) >= BALL + BUBBLE - 0.01,
      "and put outside it",
    );
    assert.equal(world.ball.touch, 0, "the bubble's owner sent it");
    assert.equal(world.ball.bounces, bounces + 1);
    steps(world, 5);
    assert.ok(!bubble.active, "it stays popped");
  }
});

test("a bubble bumps the ball whoever it belongs to", () => {
  const world = arena();
  place(world, 1, 320, 100);
  stepWorld(world, held(0, BTN));
  stepWorld(world, held(0, 0));
  place(world, 1, 580, 60);
  ballAt(world, 290, 100, 2, 0);
  assert.notEqual(
    until(world, () => !world.bubbles[1].active, new Map(), 60),
    -1,
  );
  assert.ok(world.ball.vx < 0);
  assert.equal(world.ball.touch, 1);
});

test("a rider passes through their own bubble", () => {
  const world = arena(),
    lone = arena();
  for (const each of [world, lone]) place(each, 0, 215, 200);
  stepWorld(world, held(BTN));
  stepWorld(lone, held(BTN));
  lone.bubbles[0].active = false;
  for (let i = 0; i < 200; i++) {
    const keys = i % 40 < 20 ? LEFT : RIGHT;
    stepWorld(world, held(keys));
    stepWorld(lone, held(keys));
  }
  assert.ok(world.bubbles[0].active);
  assert.deepEqual(world.riders[0], lone.riders[0]);
});

test("the other rider pops a normal bubble by touching it, and is not slowed", () => {
  const world = arena(),
    lone = arena(),
    bubble = world.bubbles[0];
  bubbleAt(world, 320, 250);
  place(lone, 0, 60, 60);
  for (const each of [world, lone]) {
    place(each, 1, 360, 250);
    each.riders[1].vx = -3 * SUB;
  }
  let popped = -1;
  for (let i = 0; i < 20; i++) {
    stepWorld(world, held(0, LEFT));
    stepWorld(lone, held(0, LEFT));
    if (popped < 0 && !bubble.active) {
      popped = i;
      assert.ok(
        distance(world.riders[1], bubble) < RIDER + BUBBLE,
        "popped on touch",
      );
    }
  }
  assert.ok(popped >= 0);
  assert.equal(world.riders[1].pops, 1);
  assert.equal(world.riders[1].x, lone.riders[1].x, "it flew straight through");
  assert.equal(world.riders[0].pops, 0);
});

test("a bubble is hard while the press that placed it is held, and normal for good once it is let go", () => {
  const world = arena(),
    bubble = world.bubbles[0];
  place(world, 0, 215, 200);
  stepWorld(world, held(BTN));
  steps(world, 30, held(BTN));
  assert.ok(bubble.active && bubble.hard);
  stepWorld(world, held(0));
  assert.ok(bubble.active && !bubble.hard);
  place(world, 0, 215, 330);
  assert.notEqual(
    until(world, () => world.riders[0].grounded),
    -1,
  );
  // Pressing again on the ground is a jump: it does not harden the bubble left behind.
  steps(world, 10, held(BTN));
  assert.ok(bubble.active && !bubble.hard);
});

test("while holding a bubble hard its owner cannot jump: they fall", () => {
  const world = arena(),
    rider = world.riders[0];
  place(world, 0, 215, 150);
  stepWorld(world, held(BTN));
  const jumps = rider.jumps;
  assert.notEqual(
    until(world, () => rider.grounded, held(BTN), 400),
    -1,
  );
  steps(world, 30, held(BTN));
  assert.equal(rider.jumps, jumps, "no jump in the air and none on landing");
  assert.ok(rider.grounded);
  assert.ok(world.bubbles[0].hard, "the bubble is still held hard");
  assert.equal(at(world.bubbles[0].y), 150);
});

test("a hard bubble bounces the ball and stays", () => {
  const world = arena(),
    bubble = world.bubbles[0];
  place(world, 0, 320, 100);
  stepWorld(world, held(BTN));
  // The owner falls away below, still holding.
  let bounced = 0;
  ballAt(world, 290, 60, 0.5, 0);
  for (let i = 0; i < 400; i++) {
    const before = world.ball.bounces;
    stepWorld(world, held(BTN));
    assert.ok(bubble.active && bubble.hard);
    assert.ok(
      distance(world.ball, bubble) >= BALL + BUBBLE - 0.01,
      "the ball is never left inside it",
    );
    if (
      world.ball.bounces > before &&
      distance(world.ball, bubble) < BALL + BUBBLE + 4
    )
      bounced++;
  }
  assert.ok(bounced >= 1, "the ball came down on it and was thrown off");
});

test("a hard bubble bounces the other rider off, and cannot be popped", () => {
  const world = arena(),
    bubble = world.bubbles[0],
    other = world.riders[1];
  place(world, 0, 215, 250);
  stepWorld(world, held(BTN));
  place(world, 1, 260, 250);
  other.vx = -3 * SUB;
  let turned = false;
  for (let i = 0; i < 60; i++) {
    stepWorld(world, held(BTN, 0));
    assert.ok(bubble.active && bubble.hard);
    assert.ok(
      distance(other, bubble) >= RIDER + BUBBLE - 0.01,
      "never inside the bubble",
    );
    turned ||= other.vx > 0;
  }
  assert.ok(turned, "it was sent back the way it came");
  assert.equal(other.pops, 0);

  // Let go, and the same bubble pops at a touch.
  stepWorld(world, held(0, 0));
  place(world, 1, 215 + 30, at(bubble.y));
  other.vx = -3 * SUB;
  assert.notEqual(
    until(world, () => !bubble.active, new Map(), 20),
    -1,
  );
  assert.equal(other.pops, 1);
});

test("a hard bubble ends the slide of a rider who runs into it", () => {
  const world = arena(),
    other = world.riders[1];
  place(world, 0, 400, 320);
  stepWorld(world, held(BTN));
  stepWorld(world, held(BTN, LEFT | DOWN | BTN));
  assert.ok(other.slide > 0);
  let stopped = false;
  for (let i = 0; i < 60 && !stopped; i++) {
    stepWorld(world, held(BTN, DOWN | BTN));
    stopped = other.slide === 0;
    assert.ok(at(other.x) > 400, "it never gets past");
  }
  assert.ok(stopped);
});

test("bubbles keep the two slots equal: mirrored inputs still play out mirrored", () => {
  const keys = [0, RIGHT, BTN, BTN, RIGHT | BTN, LEFT | BTN, DOWN | BTN, BTN];
  const W = 640 * SUB;
  for (const mapId of ["gridlock", "halo"] as const) {
    const world = playing(mapId),
      next = scripted(7),
      [a, b] = world.riders,
      [mine, theirs] = world.bubbles;
    let bits = 0,
      placed = 0,
      hard = 0;
    for (let i = 0; i < 6000; i++) {
      if (i % 6 === 0) bits = keys[next() % keys.length]!;
      stepWorld(world, held(bits, mirrored(bits)));
      assert.equal((W - a.x) % W, b.x);
      assert.equal(a.y, b.y);
      assert.equal(world.ball.x, W / 2);
      assert.equal(mine.active, theirs.active);
      assert.equal(mine.hard, theirs.hard);
      if (mine.active) assert.equal((W - mine.x) % W, theirs.x);
      placed = mine.seq;
      if (mine.hard) hard++;
    }
    assert.equal(a.pops, b.pops);
    assert.ok(
      placed > 20 && hard > 100,
      "bubbles, hard ones too, were in play",
    );
  }
});
