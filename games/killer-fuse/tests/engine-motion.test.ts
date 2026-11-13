import test from "node:test";
import assert from "node:assert/strict";
import {
  COYOTE_STEPS,
  DIVE_SPEED,
  FLAP_CATCH,
  FLAP_IMPULSE,
  FLY_MAX_RISE,
  FLY_SPEED,
  FLY_TERMINAL,
  JUMP_SPEED,
  NEUTRAL,
  QUEEN_HEIGHT,
  RUN_SPEED,
  S,
  WIDTH,
  WING_WALK_DEN,
  WING_WALK_NUM,
  WORKER_GRAVITY,
  WORKER_HALF,
  WORKER_HEIGHT,
  createRound,
  halfOf,
  heightOf,
  moveUnit,
  speedy,
  type Arena,
  type Input,
  type Rect,
  type Unit,
} from "../src/engine/index.js";
import { approach, dirOf, moveBody } from "../src/engine/motion.js";
import { control, unitOf } from "./engine-kit.js";

const FLOOR = 258;
const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x: x * S,
  y: y * S,
  w: w * S,
  h: h * S,
});
const arena = (...extra: Rect[]): Arena => ({
  id: 1,
  solids: [rect(0, FLOOR, 480, 12), ...extra],
  holes: [[], []],
  gates: [],
  piles: [],
  snail: { y: FLOOR * S, start: 240 * S, goals: [44 * S, 436 * S] },
  spawns: [],
});
const FLAT = arena();

function unit(
  kind: Unit["kind"],
  x: number,
  y: number,
  patch: Partial<Unit> = {},
): Unit {
  const made = unitOf(createRound({ seed: 1 }), 2);
  return Object.assign(
    made,
    { kind, x: x * S, y: y * S, ground: -1, vx: 0, vy: 0 },
    patch,
  );
}

function fly(
  body: Unit,
  steps: number,
  input: (index: number) => Input,
  map = FLAT,
): void {
  for (let i = 0; i < steps; i += 1) moveUnit(body, input(i), map);
}

const RIGHT = control({ right: true }),
  LEFT = control({ left: true });

test("a Worker falls onto the floor and stands on it", () => {
  const worker = unit("worker", 100, 200);
  fly(worker, 60, () => NEUTRAL);
  assert.equal(worker.ground, 0);
  assert.equal(worker.y, FLOOR * S);
  assert.equal(worker.vy, 0);
});

test("a Worker runs at run speed, turns to face its direction and stops when the stick is released", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  fly(worker, 20, () => RIGHT);
  assert.equal(worker.vx, RUN_SPEED);
  assert.equal(worker.facing, 1);
  const from = worker.x;
  fly(worker, 60, () => RIGHT);
  // 62.5 px in a second, as the original runs.
  assert.ok(Math.abs(worker.x - from - 62.5 * S) < S);
  fly(worker, 10, () => LEFT);
  assert.equal(worker.facing, -1);
  fly(worker, 10, () => NEUTRAL);
  assert.equal(worker.vx, 0);
  assert.equal(dirOf(control({ left: true, right: true })), 0);
});

test("the screen wraps horizontally in both directions", () => {
  const worker = unit("worker", 2, FLOOR, { ground: 0 });
  fly(worker, 30, () => LEFT);
  assert.ok(worker.x > WIDTH - 40 * S && worker.x < WIDTH);
  fly(worker, 60, () => RIGHT);
  assert.ok(worker.x < 40 * S);
});

function jumpHeight(worker: Unit, holdSteps: number): number {
  let top = worker.y;
  fly(worker, 80, (i) => {
    top = Math.min(top, worker.y);
    return control({ pressed: i === 0, held: i < holdSteps });
  });
  return (FLOOR * S - top) / S;
}

test("a held jump clears one 44 px platform level and a tap is a short hop", () => {
  const full = jumpHeight(unit("worker", 100, FLOOR, { ground: 0 }), 80);
  assert.ok(full > 46 && full < 54, `full jump ${full} px`);
  const tap = jumpHeight(unit("worker", 100, FLOOR, { ground: 0 }), 1);
  assert.ok(tap > 8 && tap < full / 2, `tap ${tap} px`);
});

test("releasing the button cuts the rise once, and there is no jump in the air", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  moveUnit(worker, control({ pressed: true, held: true }), FLAT);
  assert.equal(worker.vy, -JUMP_SPEED + WORKER_GRAVITY);
  assert.equal(worker.flapped, true);
  assert.equal(worker.jumping, true);
  const rising = worker.vy;
  moveUnit(worker, NEUTRAL, FLAT);
  assert.equal(worker.vy, Math.trunc(rising / 2) + WORKER_GRAVITY);
  assert.equal(worker.jumping, false);
  const before = worker.vy;
  moveUnit(worker, control({ pressed: true, held: true }), FLAT);
  assert.equal(worker.vy, before + WORKER_GRAVITY);
  assert.equal(worker.flapped, false);
});

test("a Worker may still jump for one step after walking off a ledge, and no longer", () => {
  const ledge = arena(rect(0, 200, 100, 6));
  const walkOff = (): Unit => {
    const worker = unit("worker", 100 + WORKER_HALF / S - 1, 200, {
      ground: 1,
      vx: RUN_SPEED,
    });
    let steps = 0;
    while (worker.ground >= 0 && steps < 30) {
      moveUnit(worker, RIGHT, ledge);
      steps += 1;
    }
    assert.equal(worker.ground, -1);
    assert.equal(worker.coyote, COYOTE_STEPS);
    return worker;
  };
  const quick = walkOff();
  moveUnit(quick, control({ right: true, pressed: true, held: true }), ledge);
  assert.ok(quick.vy < 0);
  assert.equal(quick.coyote, 0);
  const late = walkOff();
  for (let i = 0; i < COYOTE_STEPS; i += 1) moveUnit(late, RIGHT, ledge);
  moveUnit(late, control({ right: true, pressed: true, held: true }), ledge);
  assert.ok(late.vy > 0);
});

test("a speed Worker runs 1.35 times as fast and jumps higher", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0, speed: true });
  fly(worker, 20, () => RIGHT);
  assert.equal(worker.vx, speedy(RUN_SPEED, true));
  assert.equal(speedy(2000, true), 2700);
  assert.equal(speedy(2000, false), 2000);
  const plain = jumpHeight(unit("worker", 100, FLOOR, { ground: 0 }), 80);
  const fast = jumpHeight(
    unit("worker", 100, FLOOR, { ground: 0, speed: true }),
    80,
  );
  assert.ok(fast > plain * 1.5);
});

test("a Warrior walks slower than it flies, and each press is one flap", () => {
  const warrior = unit("warrior", 100, FLOOR, { ground: 0 });
  fly(warrior, 20, () => RIGHT);
  assert.equal(
    warrior.vx,
    Math.trunc((RUN_SPEED * WING_WALK_NUM) / WING_WALK_DEN),
  );
  moveUnit(warrior, control({ pressed: true, held: true }), FLAT);
  assert.equal(warrior.vy, -FLAP_IMPULSE);
  assert.equal(warrior.flapped, true);
  assert.equal(warrior.ground, -1);
  // Holding the button is not flapping.
  moveUnit(warrior, control({ held: true }), FLAT);
  assert.equal(warrior.flapped, false);
  assert.ok(warrior.vy > -FLAP_IMPULSE);
  fly(warrior, 12, () => control({ right: true, pressed: true }));
  assert.equal(warrior.vy, -FLY_MAX_RISE);
  fly(warrior, 30, () => RIGHT);
  assert.equal(warrior.vx, FLY_SPEED);
});

test("a flyer falls no faster than its terminal speed and one flap always catches it", () => {
  const warrior = unit("warrior", 100, 40);
  fly(warrior, 40, () => NEUTRAL);
  assert.equal(warrior.vy, FLY_TERMINAL);
  moveUnit(warrior, control({ pressed: true }), FLAT);
  assert.equal(warrior.vy, FLAP_CATCH - FLAP_IMPULSE);
});

test("the top of the screen is a ceiling", () => {
  const queen = unit("queen", 100, 60);
  fly(queen, 120, () => control({ pressed: true }));
  assert.equal(queen.y, QUEEN_HEIGHT);
  assert.equal(queen.vy, 0);
});

test("a Queen dives straight down while down is held in the air; a Warrior and a grounded Queen do not", () => {
  const queen = unit("queen", 100, 60);
  fly(queen, 5, () => control({ down: true, right: true }));
  assert.equal(queen.diving, true);
  assert.equal(queen.vy, DIVE_SPEED);
  assert.ok(queen.vx > 0 && queen.vx <= FLY_SPEED / 2);
  fly(queen, 80, () => control({ down: true }));
  assert.equal(queen.ground, 0);
  assert.equal(queen.diving, false);
  assert.equal(queen.y, FLOOR * S);
  const warrior = unit("warrior", 200, 60);
  moveUnit(warrior, control({ down: true }), FLAT);
  assert.equal(warrior.diving, false);
});

test("walls stop a unit from either side and a platform above stops a jump", () => {
  const pillar = arena(rect(200, 200, 20, 58), rect(300, 236, 60, 6));
  const fromLeft = unit("worker", 180, FLOOR, { ground: 0 });
  fly(fromLeft, 40, () => RIGHT, pillar);
  assert.equal(fromLeft.x, 200 * S - WORKER_HALF);
  assert.equal(fromLeft.vx, 0);
  const fromRight = unit("worker", 240, FLOOR, { ground: 0 });
  fly(fromRight, 40, () => LEFT, pillar);
  assert.equal(fromRight.x, 220 * S + WORKER_HALF);
  const under = unit("worker", 330, FLOOR, { ground: 0 });
  let top = under.y;
  fly(
    under,
    30,
    (i) => {
      top = Math.min(top, under.y);
      return control({ pressed: i === 0, held: true });
    },
    pillar,
  );
  assert.equal(top, 242 * S + WORKER_HEIGHT);
});

test("a wall that ends at the screen edge also stops a unit coming across the wrap", () => {
  const edge = arena(rect(460, 200, 20, 58));
  const worker = unit("worker", 12, FLOOR, { ground: 0 });
  fly(worker, 40, () => LEFT, edge);
  assert.equal(worker.x, WORKER_HALF);
  const body = { x: 478 * S, y: 100 * S, vx: 4 * S, vy: 0 };
  const contact = moveBody(body, 3 * S, 6 * S, edge);
  assert.deepEqual(contact, { wall: false, ceiling: false, ground: -1 });
  assert.equal(body.x, 2 * S);
});

test("body sizes and the approach helper", () => {
  assert.ok(halfOf("queen") > halfOf("worker"));
  assert.equal(halfOf("warrior"), halfOf("worker"));
  assert.ok(heightOf("queen") > heightOf("warrior"));
  assert.equal(heightOf("warrior"), heightOf("worker"));
  assert.equal(approach(0, 10, 4), 4);
  assert.equal(approach(8, 10, 4), 10);
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(approach(2, 0, 4), 0);
});
