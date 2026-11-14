import test from "node:test";
import assert from "node:assert/strict";
import * as basics from "../src/basics.js";
import {
  CAPACITY,
  CLASSIC_TARGET,
  INPUT_MASK,
  JUMP,
  LEFT,
  MOST_HITS,
  RALLY_TARGET,
  RIGHT,
  SCORE_CAP,
  isInput,
  mirrored,
} from "../src/engine/index.js";
import { div, isqrt, round, seedOf, xorshift } from "../src/engine/math.js";
import {
  collide,
  countTouches,
  decided,
  pointAgainst,
  stepBall,
  stepBlob,
} from "../src/engine/step.js";
import * as T from "../src/engine/tuning.js";
import { fresh, rally, steps, until } from "./fixtures/world.js";

test("basics repeats the engine's constants", () => {
  assert.equal(basics.CAPACITY, CAPACITY);
  assert.equal(basics.RALLY_TARGET, RALLY_TARGET);
  assert.equal(basics.CLASSIC_TARGET, CLASSIC_TARGET);
  assert.equal(basics.SCORE_CAP, SCORE_CAP);
  assert.equal(basics.MOST_HITS, MOST_HITS);
});

test("integer helpers: truncating division, round half away from zero, integer square root, xorshift", () => {
  assert.equal(div(-7, 2), -3);
  assert.ok(!Object.is(div(-1, 2), -0));
  assert.equal(round(5, 2), 3);
  assert.equal(round(-5, 2), -3);
  assert.equal(round(4, 3), 1);
  assert.equal(round(-4, 3), -1);
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99_980_001, 2 ** 40 + 5])
    assert.equal(isqrt(n), Math.floor(Math.sqrt(n)));
  let x = 1;
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    x = xorshift(x);
    assert.ok(x > 0 && x <= 0xffff_ffff);
    seen.add(x);
  }
  assert.equal(seen.size, 1000);
  assert.notEqual(seedOf("a"), seedOf("b"));
  assert.ok(seedOf("") > 0);
});

test("input bits: three held bits, mirrored by swapping left and right", () => {
  assert.equal(INPUT_MASK, 7);
  assert.ok(isInput(LEFT | RIGHT | JUMP));
  assert.ok(!isInput(8));
  assert.ok(!isInput(-1));
  assert.ok(!isInput(1.5));
  assert.ok(!isInput("1"));
  assert.equal(mirrored(LEFT | JUMP), RIGHT | JUMP);
  assert.equal(mirrored(RIGHT), LEFT);
  assert.equal(mirrored(LEFT | RIGHT), LEFT | RIGHT);
});

test("a blob runs 3 px a step within its half, the same in the air", () => {
  const world = fresh();
  const left = world.blobs[0];
  steps(world, 10, RIGHT);
  assert.equal(left.x, T.BLOB_START[0] + 30);
  steps(world, 200, RIGHT);
  assert.equal(left.x, T.BLOB_MAX[0]);
  steps(world, 300, LEFT);
  assert.equal(left.x, T.BLOB_MIN[0]);
  steps(world, 200, 0, LEFT);
  assert.equal(world.blobs[1].x, T.BLOB_MIN[1]);
  // Both ways at once cancel out.
  const x = world.blobs[1].x + 0;
  steps(world, 5, 0, LEFT | RIGHT);
  assert.equal(world.blobs[1].x, x);
});

test("a held jump peaks at the original's 264 px; a tap at about half that", () => {
  const apex = (holdSteps: number) => {
    const world = fresh();
    let top = 0;
    for (let i = 0; i < 200; i++) {
      stepBlob(world.blobs[0], i < holdSteps ? JUMP : 0, i);
      top = Math.max(top, world.blobs[0].y);
      if (i > 0 && !world.blobs[0].air) break;
    }
    return (top - T.BLOB_FLOOR) / T.HU;
  };
  assert.equal(Math.floor(apex(200)), 264);
  const tap = apex(1);
  assert.ok(tap > 125 && tap < 145, `tap apex ${tap}`);
  assert.ok(apex(20) > tap && apex(20) < 264);
});

test("holding jump through a landing jumps again at once", () => {
  const world = fresh();
  const blob = world.blobs[0];
  let landed = false;
  for (let i = 0; i < 300; i++) {
    stepBlob(blob, JUMP, i);
    if (blob.y === T.BLOB_FLOOR && i > 0) landed = true;
    if (landed) {
      stepBlob(blob, JUMP, i + 1);
      break;
    }
  }
  assert.ok(landed);
  assert.ok(blob.air && blob.y > T.BLOB_FLOOR, "airborne again the next step");
});

test("the squash cycle runs 0 to 4 and back on landing and while walking, one frame every 4 steps", () => {
  const world = fresh();
  const blob = world.blobs[0];
  const frames: number[] = [];
  for (let i = 0; i < 60; i++) {
    stepBlob(blob, RIGHT, i);
    if (i % 4 === 0) frames.push(blob.frame);
  }
  assert.deepEqual(frames.slice(0, 8), [1, 2, 3, 4, 3, 2, 1, 0]);
  assert.ok(frames.slice(8).includes(4), "and it keeps cycling while walking");
  const still = fresh().blobs[0];
  for (let i = 0; i < 40; i++) stepBlob(still, 0, i);
  assert.equal(still.frame, 0);
});

test("the ball falls 3 then 4 units a step, eased by drag while falling", () => {
  const world = rally(fresh(), 200, 400);
  world.step = 0;
  stepBall(world);
  assert.equal(world.ball.vy, -3);
  world.step = 1;
  stepBall(world);
  assert.equal(world.ball.vy, -7);
  // Falling fast, gravity eases: at −300 it is floor(floor(300/3)/32) = 3 less.
  world.ball.vy = -300;
  world.step = 0;
  stepBall(world);
  assert.equal(world.ball.vy, -300);
});

test("a hovering serve stays put until touched, then falls after the timeout", () => {
  const world = fresh();
  const { x, y } = world.ball;
  steps(world, 100);
  assert.equal(world.phase, "serve");
  assert.deepEqual([world.ball.x, world.ball.y], [x, y]);
  steps(world, T.SERVE_TIMEOUT - 100);
  assert.equal(world.phase, "rally");
  assert.ok(world.ball.live);
});

test("the sand keeps 3/4 of the ball's speed and the walls turn it back without loss", () => {
  const world = rally(fresh(), 200, 140, 40, -200);
  world.phase = "dead";
  world.phaseSteps = T.DEAD_STEPS;
  until(world, (w) => w.ball.vy > 0, 100);
  assert.equal(world.ball.y, T.BALL_FLOOR);
  assert.ok(world.ball.vx === 30, `vx ${world.ball.vx}`);
  const walls = rally(fresh(), 33, 400, -100, 0);
  walls.phase = "dead";
  walls.phaseSteps = T.DEAD_STEPS;
  stepBall(walls);
  assert.equal(walls.ball.vx, 100);
  assert.equal(walls.ball.x, T.BALL_LEFT);
});

test("the pole turns a low ball back from either side, mirror-exactly", () => {
  for (const [x, vx, expect] of [
    [355, 8, T.POLE_PUT_LEFT],
    [445, -8, T.POLE_PUT_RIGHT],
  ] as const) {
    const world = rally(fresh(), x, 200, vx * T.BU, 0);
    world.phase = "dead";
    world.phaseSteps = T.DEAD_STEPS;
    for (let i = 0; i < 4; i++) stepBall(world);
    assert.equal(world.ball.x > T.NET_X * T.BU, expect > T.NET_X * T.BU);
    assert.equal(Math.sign(world.ball.vx), -Math.sign(vx));
  }
  // Mirror: a world and its mirror image stay mirrored through pole bounces.
  for (let x = 330; x < 470; x += 3) {
    const a = rally(fresh(), x, 150, 211, 50),
      b = rally(fresh(), 800 - x, 150, -211, 50);
    b.ball.x = T.COURT_W * T.BU - a.ball.x;
    b.ball.prevX = b.ball.x;
    a.phase = b.phase = "dead";
    a.phaseSteps = b.phaseSteps = T.DEAD_STEPS;
    for (let i = 0; i < 60; i++) {
      stepBall(a);
      stepBall(b);
      a.step++;
      b.step++;
      assert.equal(a.ball.x, T.COURT_W * T.BU - b.ball.x, `from ${x}`);
      assert.equal(a.ball.y, b.ball.y);
    }
  }
});

test("a fast low ball never tunnels through the net", () => {
  for (const [x, vx] of [
    [362, 300],
    [438, -300],
  ] as const) {
    const world = rally(fresh(), x, 200, vx, 0);
    world.phase = "dead";
    world.phaseSteps = T.DEAD_STEPS;
    for (let i = 0; i < 30; i++) {
      stepBall(world);
      world.step++;
      const px = world.ball.x / T.BU;
      assert.ok(
        vx > 0 ? px < T.NET_X : px > T.NET_X,
        `stayed on its side, at ${px}`,
      );
    }
  }
});

test("a blob sends the ball off at exactly 256 units a step along the contact normal and pushes it clear", () => {
  const world = fresh();
  const blob = world.blobs[0];
  // Straight above the head, falling onto it.
  rally(world, blob.x, 100 + 65 + 50, 0, -100);
  collide(world);
  assert.equal(world.ball.vx, 0);
  assert.equal(world.ball.vy, 256);
  assert.ok(blob.contact);
  const head = { x: blob.x * T.BU, y: T.BLOB_FLOOR / 8 + 65 * T.BU };
  const d = Math.hypot(world.ball.x - head.x, world.ball.y - head.y);
  assert.ok(d > T.HEAD_OUT, `pushed out to ${d / T.BU} px`);
  // Off to one side: the speed is still 256 within rounding.
  rally(world, blob.x + 30, 100 + 65 + 40, 0, -100);
  collide(world);
  const speed = Math.hypot(world.ball.vx, world.ball.vy);
  assert.ok(Math.abs(speed - 256) < 1.5, `speed ${speed}`);
  assert.ok(world.ball.vx > 0);
});

test("a graze (ball already leaving along the normal) bounces but is not a touch", () => {
  const world = fresh();
  const blob = world.blobs[0];
  rally(world, blob.x, 100 + 65 + 50, 0, 200);
  collide(world);
  assert.ok(!blob.contact);
  assert.equal(world.ball.vy, 256);
});

test("the ball exactly on a head's centre is thrown straight up", () => {
  const world = fresh();
  const blob = world.blobs[0];
  rally(world, blob.x, 100 + 65, 0, 0);
  collide(world);
  assert.deepEqual([world.ball.vx, world.ball.vy], [0, 256]);
});

test("the net's top throws the ball at 128 a step, and a dead-centre hit is nudged by the world's generator", () => {
  const world = rally(fresh(), 420, 329 + 30, 0, -50);
  collide(world);
  assert.ok(Math.abs(Math.hypot(world.ball.vx, world.ball.vy) - 128) < 1.5);
  assert.equal(world.netCounter, 1);
  const centre = rally(fresh(), 400, 329 + 30, 0, -50),
    rng = centre.rng;
  collide(centre);
  assert.notEqual(centre.rng, rng, "the nudge drew from the generator");
  assert.ok(Math.abs(centre.ball.vx) <= 2);
  assert.equal(centre.ball.vy, 128);
});

test("touches count once per contact; the fourth in a row is a fault and the other side's touch resets them", () => {
  const world = rally(fresh(), 200, 400);
  const [left, right] = world.blobs;
  for (let i = 1; i <= 3; i++) {
    left.contact = true;
    countTouches(world);
    assert.equal(left.touches, i);
    countTouches(world); // no contact: the next contact starts a new touch
  }
  right.touches = 2;
  left.contact = true;
  world.blobs[1].touches = 0;
  countTouches(world);
  assert.equal(world.phase, "dead");
  assert.equal(world.lastFault, 0);
  assert.deepEqual(world.score, [0, 1]);
  // A ball well over the net clears the side's count.
  const other = rally(fresh(), 420, 400);
  other.blobs[0].touches = 2;
  countTouches(other);
  assert.equal(other.blobs[0].touches, 0);
});

test("holding the ball for more than 40 frames is carrying", () => {
  const world = rally(fresh(), 200, 400);
  const left = world.blobs[0];
  left.contact = true;
  countTouches(world);
  for (let i = 0; i < 40; i++) {
    left.contact = true;
    countTouches(world);
    assert.equal(world.phase, "rally");
  }
  left.contact = true;
  countTouches(world);
  assert.equal(world.phase, "dead");
  assert.equal(world.lastFault, 0);
});

test("the ball on the sand ends the rally against the side it landed on", () => {
  for (const [x, loser] of [
    [200, 0],
    [600, 1],
  ] as const) {
    const world = rally(fresh(), x, 140, 0, -50);
    until(world, (w) => w.phase === "dead", 100);
    assert.equal(world.lastFault, loser);
  }
});

test("rally scoring: every rally scores and the winner serves; classic: only the server scores", () => {
  const world = fresh("rally");
  world.server = 0;
  pointAgainst(world, 0, false);
  assert.deepEqual(world.score, [0, 1]);
  assert.equal(world.server, 1);
  const classic = fresh("classic");
  classic.server = 0;
  pointAgainst(classic, 0, false);
  assert.deepEqual(classic.score, [0, 0], "a side-out scores nothing");
  assert.equal(classic.server, 1);
  pointAgainst(classic, 0, false);
  assert.deepEqual(classic.score, [0, 1]);
  assert.equal(classic.target, 15);
  assert.equal(world.target, 11);
});

test("a match is won at the target by two, and decided by the next point at the cap", () => {
  assert.ok(decided([11, 9], 0, 11));
  assert.ok(!decided([11, 10], 0, 11));
  assert.ok(decided([13, 11], 0, 11));
  assert.ok(decided([40, 39], 0, 11));
  assert.ok(!decided([10, 0], 0, 11));
  const world = fresh();
  world.score = [10, 3];
  world.server = 0;
  pointAgainst(world, 1, false);
  assert.equal(world.winner, 0);
  assert.equal(world.phase, "dead");
  steps(world, T.DEAD_STEPS + 1);
  assert.equal(world.phase, "over");
  const frozen = world.step;
  steps(world, 10, RIGHT);
  assert.equal(world.step, frozen, "a finished match no longer steps");
});

test("after a point the ball settles for 2 s, then the next serve waits for both blobs to land", () => {
  const world = fresh();
  // The left blob is high in the air when the point ends: the serve waits for it to come down.
  steps(world, 20, JUMP);
  assert.ok(world.blobs[0].air);
  pointAgainst(world, 1, true);
  assert.equal(world.server, 0);
  steps(world, T.DEAD_STEPS - 1, JUMP, JUMP);
  assert.equal(world.phase, "dead");
  // Both players hold jump through the settle: nobody starts a jump, so the serve still comes.
  until(world, (w) => w.phase === "serve", 300, JUMP, JUMP);
  assert.equal(world.phase, "serve");
  assert.ok(!world.blobs[0].air && !world.blobs[1].air);
  assert.equal(world.ball.x, T.SERVE_X[0]);
  assert.ok(!world.ball.live);
});

test("the serve is a touch, and play continues into a rally", () => {
  const world = fresh("rally", 99);
  const server = world.server;
  const blob = world.blobs[server];
  // Walk under the ball and jump into it.
  const target = T.SERVE_X[server] / T.BU - (server === 0 ? 10 : -10);
  until(
    world,
    (w) => Math.abs(w.blobs[server].x - target) <= 3,
    200,
    server === 0 ? (blob.x < target ? RIGHT : LEFT) : 0,
    server === 1 ? (blob.x < target ? RIGHT : LEFT) : 0,
  );
  const jump = (w: typeof world) => w.phase !== "serve";
  until(world, jump, 200, server === 0 ? JUMP : 0, server === 1 ? JUMP : 0);
  assert.equal(world.phase, "rally");
  steps(world, 4);
  assert.equal(world.blobs[server].touches, 1);
  assert.equal(world.hitCounter, 1);
  assert.equal(world.lastTouch, server);
});
