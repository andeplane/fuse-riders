import test from "node:test";
import assert from "node:assert/strict";
import {
  COYOTE_STEPS,
  DIVE_ACCEL,
  DIVE_SPEED,
  FLAP_IMPULSE,
  FLAP_STEPS,
  FLAP_THRUST,
  FLY_GRAVITY,
  FLY_GRAVITY_LIGHT,
  FLY_MAX_RISE,
  FLY_SPEED,
  FLY_TERMINAL,
  HOVER_HZ,
  JUMP_SPEED,
  MAX_FLAPS,
  NEUTRAL,
  PRESS_BUFFER,
  QUEEN_HEIGHT,
  RUN_SPEED,
  S,
  TAKEOFF_STEPS,
  TAKEOFF_THRUST,
  WARRIOR_HEIGHT,
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
import { approach, dirOf, moveBody, steer } from "../src/engine/motion.js";
import { control, unitOf } from "./engine-kit.js";

const FLOOR = 265;
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
  eggSpots: [[], []],
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
  // A Worker on the ground stops dead.
  moveUnit(worker, NEUTRAL, FLAT);
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

test("a held jump clears one 30 px platform level and a tap is a short hop", () => {
  const full = jumpHeight(unit("worker", 100, FLOOR, { ground: 0 }), 80);
  assert.ok(full > 34 && full < 40, `full jump ${full} px`);
  const tap = jumpHeight(unit("worker", 100, FLOOR, { ground: 0 }), 1);
  assert.ok(tap > 5 && tap < full / 2, `tap ${tap} px`);
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

test("a Worker keeps little of its speed in the air once the stick is released", () => {
  const worker = unit("worker", 100, 100, { vx: RUN_SPEED });
  moveUnit(worker, NEUTRAL, FLAT);
  assert.equal(worker.vx, RUN_SPEED - Math.trunc((RUN_SPEED * 6) / 35));
  fly(worker, 30, () => NEUTRAL);
  assert.equal(worker.vx, 0);
});

test("steering: speed builds to the top, drag works only when not pushing along the motion", () => {
  const drag = [1, 10] as const;
  // Pushing along the motion: no drag, capped at the top.
  assert.equal(steer(100, 1, 50, 1000, drag), 150);
  assert.equal(steer(980, 1, 50, 1000, drag), 1000);
  assert.equal(steer(-980, -1, 50, 1000, drag), -1000);
  // Turning: drag and the push both work against the motion.
  assert.equal(steer(1000, -1, 50, 1000, drag), 850);
  // Faster than the top after a bounce: drag brings it back, the stick adds nothing.
  assert.equal(steer(2000, 1, 50, 1000, drag), 1800);
  // Coasting: drag, then rest.
  assert.equal(steer(1000, 0, 50, 1000, drag), 900);
  assert.equal(steer(-1000, 0, 50, 1000, drag), -900);
  assert.equal(steer(30, 0, 50, 1000, drag), 0);
});

// --- Flight ---------------------------------------------------------------------------------------------------------

const PRESS = control({ pressed: true, held: true });
const HIGH = 2000;
/** A Warrior in open air, far above the floor. */
const airborne = (patch: Partial<Unit> = {}): Unit =>
  unit("warrior", 100, HIGH, patch);
const DEEP = arena(rect(0, 5000, 480, 10));
/** Pixels climbed (negative: fallen) after `seconds` of pressing every `period` steps. */
function climb(
  period: number,
  seconds: number,
  patch: Partial<Unit> = {},
): number {
  const flyer = airborne(patch);
  fly(flyer, seconds * 60, (i) => (i % period === 0 ? PRESS : NEUTRAL), DEEP);
  return (HIGH * S - flyer.y) / S;
}

test("a Warrior walks slower than it flies and slides a little when it lets go", () => {
  const warrior = unit("warrior", 100, FLOOR, { ground: 0 });
  fly(warrior, 60, () => RIGHT);
  const walk = Math.trunc((RUN_SPEED * WING_WALK_NUM) / WING_WALK_DEN);
  assert.equal(warrior.vx, walk);
  moveUnit(warrior, NEUTRAL, FLAT);
  assert.equal(warrior.vx, walk - Math.trunc((walk * 4) / 15));
  fly(warrior, 20, () => NEUTRAL);
  assert.equal(warrior.vx, 0);
  assert.equal(warrior.ground, 0);
  const flyer = airborne();
  fly(flyer, 40, () => RIGHT, DEEP);
  assert.equal(flyer.vx, FLY_SPEED);
  // In the air it glides: a second later it still has a quarter of its speed.
  fly(flyer, 40, () => NEUTRAL, DEEP);
  assert.ok(flyer.vx > FLY_SPEED / 5 && flyer.vx < FLY_SPEED / 3);
});

test("a flap is a push, not a jump: thrust for 0.3 s that about balances gravity", () => {
  assert.equal(FLAP_STEPS, 18);
  assert.equal(FLAP_IMPULSE, FLAP_THRUST * FLAP_STEPS);
  const flyer = airborne();
  moveUnit(flyer, PRESS, DEEP);
  assert.equal(flyer.flapped, true);
  assert.equal(flyer.vy, FLY_GRAVITY - FLAP_THRUST);
  moveUnit(flyer, NEUTRAL, DEEP);
  assert.equal(flyer.flapped, false);
  assert.equal(flyer.vy, 2 * (FLY_GRAVITY - FLAP_THRUST));
  fly(flyer, FLAP_STEPS - 2, () => NEUTRAL, DEEP);
  assert.equal(flyer.vy, FLAP_STEPS * (FLY_GRAVITY - FLAP_THRUST));
  assert.deepEqual(flyer.flaps, [0, 0, 0, 0, 0]);
  // The push is over: gravity alone.
  moveUnit(flyer, NEUTRAL, DEEP);
  assert.equal(
    flyer.vy,
    FLAP_STEPS * (FLY_GRAVITY - FLAP_THRUST) + FLY_GRAVITY,
  );
});

test("one press from a hover rises about 6 px", () => {
  const flyer = airborne();
  let top = flyer.y;
  fly(
    flyer,
    60,
    (i) => {
      top = Math.min(top, flyer.y);
      return i === 0 ? PRESS : NEUTRAL;
    },
    DEEP,
  );
  const rise = (HIGH * S - top) / S;
  assert.ok(rise > 5 && rise < 7, `rose ${rise} px`);
});

test("holding the button does nothing", () => {
  const held = airborne(),
    idle = airborne();
  fly(held, 60, () => control({ held: true }), DEEP);
  fly(idle, 60, () => NEUTRAL, DEEP);
  assert.equal(held.y, idle.y);
  assert.equal(held.vy, FLY_TERMINAL);
  assert.equal(held.flapped, false);
});

test("flaps overlap and add up, five at most, and the climb is capped", () => {
  const flyer = airborne();
  moveUnit(flyer, PRESS, DEEP);
  moveUnit(flyer, PRESS, DEEP);
  assert.equal(flyer.vy, 3 * FLY_GRAVITY - 3 * FLAP_THRUST - FLY_GRAVITY);
  fly(flyer, MAX_FLAPS - 2, () => PRESS, DEEP);
  assert.equal(flyer.flaps.filter((left) => left > 0).length, MAX_FLAPS);
  // A sixth press while five run is lost.
  moveUnit(flyer, PRESS, DEEP);
  assert.equal(flyer.flapped, false);
  fly(flyer, 6, () => NEUTRAL, DEEP);
  assert.equal(flyer.vy, -FLY_MAX_RISE);
  const fast = airborne({ speed: true });
  fly(fast, 12, () => PRESS, DEEP);
  assert.equal(fast.vy, -Math.trunc((FLY_MAX_RISE * 23) / 20));
});

test("a fall is capped, one flap only slows it, two overlapping ones turn it into a climb within 0.17 s", () => {
  const one = airborne();
  fly(one, 40, () => NEUTRAL, DEEP);
  assert.equal(one.vy, FLY_TERMINAL);
  fly(one, FLAP_STEPS, (i) => (i === 0 ? PRESS : NEUTRAL), DEEP);
  assert.ok(one.vy > 0 && one.vy < FLY_TERMINAL);
  const two = airborne({ vy: FLY_TERMINAL });
  let steps = 0;
  while (two.vy >= 0 && steps < 60) {
    moveUnit(two, steps < 2 ? PRESS : NEUTRAL, DEEP);
    steps += 1;
  }
  assert.ok(steps <= 10, `rising after ${steps} steps`);
});

test("press rate against height over five seconds: 2 a second sinks, about 2.8 holds, 3 and more climb", () => {
  // Presses a second -> pixels gained in 5 s. docs/engine.md quotes these.
  const table = {
    2: climb(30, 5),
    2.73: climb(22, 5),
    2.86: climb(21, 5),
    3: climb(20, 5),
    4: climb(15, 5),
    6: climb(10, 5),
  };
  assert.ok(table[2] < -400, `2 Hz ${table[2]}`);
  // The balance point lies between 22 and 21 steps a press; 21.7 is the exact figure.
  assert.ok(Math.abs(table[2.73]) < 20, `2.73 Hz ${table[2.73]}`);
  assert.ok(table[2.86] > 100, `2.86 Hz ${table[2.86]}`);
  assert.ok(table[3] > 300 && table[3] < 420, `3 Hz ${table[3]}`);
  assert.ok(table[4] > 430, `4 Hz ${table[4]}`);
  // Mashing gains nothing over four a second: the climb is capped at 96 px/s.
  assert.ok(table[6] >= table[4] && table[6] < 485, `6 Hz ${table[6]}`);
  assert.equal(HOVER_HZ, 3);
});

test("after a take-off gravity is weaker until the next landing: 1.9 presses a second hold a height", () => {
  assert.ok(climb(32, 5, { light: true }) > 0);
  assert.ok(climb(34, 5, { light: true }) < 0);
  assert.ok(Math.abs(climb(32, 5, { light: true })) < 60);
  const flyer = airborne({ light: true });
  moveUnit(flyer, NEUTRAL, DEEP);
  assert.equal(flyer.vy, FLY_GRAVITY_LIGHT);
});

test("a press on the ground is a take-off, not a flap: a short strong push that ends running flaps", () => {
  const warrior = unit("warrior", 100, FLOOR, { ground: 0 });
  warrior.flaps[0] = 7;
  moveUnit(warrior, PRESS, FLAT);
  assert.equal(warrior.flapped, true);
  assert.equal(warrior.light, true);
  assert.deepEqual(warrior.flaps, [0, 0, 0, 0, 0]);
  assert.equal(warrior.ground, -1);
  assert.equal(warrior.vy, FLY_GRAVITY_LIGHT - TAKEOFF_THRUST);
  fly(warrior, TAKEOFF_STEPS - 1, () => NEUTRAL);
  const launch = TAKEOFF_STEPS * (TAKEOFF_THRUST - FLY_GRAVITY_LIGHT);
  assert.equal(warrior.vy, -launch);
  // About 85 px/s.
  assert.ok(Math.abs((launch * 60) / S - 85) < 1);
  let top = warrior.y;
  fly(warrior, 120, () => {
    top = Math.min(top, warrior.y);
    return NEUTRAL;
  });
  const rise = (FLOOR * S - top) / S;
  assert.ok(rise > 9 && rise < 13, `take-off alone rises ${rise} px`);
  // Landed: normal gravity again, nothing left running.
  assert.equal(warrior.ground, 0);
  assert.equal(warrior.light, false);
  assert.equal(warrior.takeoff, 0);
});

test("the top of the screen is a ceiling, and mashing sticks a flyer to it", () => {
  const queen = unit("queen", 100, 60);
  fly(queen, 120, (i) => (i % 6 === 0 ? PRESS : NEUTRAL));
  assert.equal(queen.y, QUEEN_HEIGHT);
  assert.equal(queen.vy, 0);
  fly(queen, 60, (i) => (i % 6 === 0 ? PRESS : NEUTRAL));
  assert.equal(queen.y, QUEEN_HEIGHT);
});

test("a stunned flyer cannot flap or take off until the stun runs out", () => {
  const flyer = airborne({ stun: 3 });
  fly(flyer, 3, () => PRESS, DEEP);
  assert.equal(flyer.flapped, false);
  assert.equal(flyer.vy, 3 * FLY_GRAVITY);
  assert.equal(flyer.stun, 0);
  moveUnit(flyer, PRESS, DEEP);
  assert.equal(flyer.flapped, true);
  const grounded = unit("warrior", 100, FLOOR, { ground: 0, stun: 5 });
  moveUnit(grounded, PRESS, FLAT);
  assert.equal(grounded.ground, 0);
});

test("a Queen's dive starts on the down press in the air, speeds up to the dive speed and ends on release", () => {
  const queen = unit("queen", 100, HIGH, { vy: -FLY_MAX_RISE });
  queen.flaps[0] = 9;
  const dive = control({ down: true, right: true });
  moveUnit(queen, dive, DEEP);
  assert.equal(queen.diving, true);
  // The climb is not cancelled, only pushed against; running flaps end, and a press does nothing while diving.
  assert.equal(queen.vy, -FLY_MAX_RISE + DIVE_ACCEL);
  assert.deepEqual(queen.flaps, [0, 0, 0, 0, 0]);
  let top = queen.y;
  let steps = 1;
  while (queen.vy < DIVE_SPEED && steps < 60) {
    moveUnit(queen, { ...dive, pressed: true, held: true }, DEEP);
    top = Math.min(top, queen.y);
    steps += 1;
  }
  assert.equal(queen.flapped, false);
  // She still rises about 4 px before she turns, and is at full speed within 0.45 s.
  const rise = (HIGH * S - top) / S;
  assert.ok(rise > 3 && rise < 7, `rose ${rise} px`);
  assert.ok(steps >= 21 && steps <= 27, `full speed after ${steps} steps`);
  assert.ok(queen.vx > 0 && queen.vx <= FLY_SPEED);
  moveUnit(queen, RIGHT, DEEP);
  assert.equal(queen.diving, false);
  assert.ok(queen.vy <= FLY_TERMINAL);
});

test("a dive ends on landing, needs a new press, and only a Queen in the air can dive", () => {
  const queen = unit("queen", 100, FLOOR - 40);
  const down = control({ down: true });
  fly(queen, 80, () => down);
  assert.equal(queen.ground, 0);
  assert.equal(queen.diving, false);
  assert.equal(queen.y, FLOOR * S);
  // Down still held on the ground, then a take-off: no dive without a fresh press.
  fly(queen, 10, (i) => control({ down: true, pressed: i === 0 }));
  assert.equal(queen.ground, -1);
  assert.equal(queen.diving, false);
  moveUnit(queen, NEUTRAL, FLAT);
  moveUnit(queen, down, FLAT);
  assert.equal(queen.diving, true);
  const warrior = unit("warrior", 200, 60);
  moveUnit(warrior, down, FLAT);
  assert.equal(warrior.diving, false);
});

test("walls stop a unit from either side and a platform above stops a jump", () => {
  const pillar = arena(rect(200, 200, 20, 65), rect(300, 243, 60, 6));
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
  assert.equal(top, 249 * S + WORKER_HEIGHT);
});

test("a wall that ends at the screen edge also stops a unit coming across the wrap", () => {
  const edge = arena(rect(460, 200, 20, 65));
  const worker = unit("worker", 12, FLOOR, { ground: 0 });
  fly(worker, 40, () => LEFT, edge);
  assert.equal(worker.x, WORKER_HALF);
  const body = { x: 478 * S, y: 100 * S, vx: 4 * S, vy: 0 };
  const contact = moveBody(body, 3 * S, 6 * S, edge);
  assert.deepEqual(contact, { wall: false, ceiling: false, ground: -1 });
  assert.equal(body.x, 2 * S);
});

test("body sizes and the approach helper", () => {
  // Arcade boxes at half scale: a Worker is 8 by 12, a Warrior and a Queen 10 by 17.
  assert.equal(halfOf("worker"), 4 * S);
  assert.equal(heightOf("worker"), 12 * S);
  assert.equal(halfOf("warrior"), 5 * S);
  assert.equal(heightOf("warrior"), WARRIOR_HEIGHT);
  assert.equal(halfOf("queen"), halfOf("warrior"));
  assert.equal(heightOf("queen"), heightOf("warrior"));
  assert.equal(approach(0, 10, 4), 4);
  assert.equal(approach(8, 10, 4), 10);
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(approach(2, 0, 4), 0);
});

const HELD = control({ held: true });

test("a press up to three steps early still fires: a Worker's jump just before it lands, a flap at the end of a stun", () => {
  // Steps from a press in the air to the landing, by how far above the floor the fall starts.
  const landsAfter = (height: number): number => {
    const probe = unit("worker", 100, FLOOR - height);
    let steps = 0;
    while (probe.ground < 0) {
      moveUnit(probe, NEUTRAL, FLAT);
      steps += 1;
    }
    return steps;
  };
  const jumped = (lead: number): boolean => {
    const height = 20;
    const worker = unit("worker", 100, FLOOR - height);
    const total = landsAfter(height);
    // The press comes `lead` steps before the first step on which the Worker stands on the floor.
    for (let i = 0; i < total + 1; i += 1)
      moveUnit(worker, i === total - lead ? PRESS : HELD, FLAT);
    return worker.vy < 0 && worker.jumping;
  };
  assert.equal(jumped(0), true);
  assert.equal(jumped(PRESS_BUFFER), true);
  assert.equal(jumped(PRESS_BUFFER + 1), false);

  const warrior = unit("warrior", 100, 150, { stun: PRESS_BUFFER });
  moveUnit(warrior, PRESS, FLAT);
  assert.equal(warrior.buffer, PRESS_BUFFER);
  assert.ok(warrior.flaps.every((left) => left === 0));
  fly(warrior, PRESS_BUFFER - 1, () => NEUTRAL);
  assert.ok(warrior.flaps.every((left) => left === 0));
  moveUnit(warrior, NEUTRAL, FLAT);
  assert.equal(warrior.flaps.filter((left) => left > 0).length, 1);
  assert.equal(warrior.buffer, 0);
  // Pressed too early, it is forgotten.
  const early = unit("warrior", 100, 150, { stun: PRESS_BUFFER + 2 });
  moveUnit(early, PRESS, FLAT);
  fly(early, PRESS_BUFFER + 4, () => NEUTRAL);
  assert.ok(early.flaps.every((left) => left === 0));
  assert.equal(early.buffer, 0);
});

test("a press every 8 steps (the page's hold-to-flap) stacks three flaps and climbs; down held from the ground starts no dive", () => {
  const warrior = unit("warrior", 100, 200);
  let most = 0;
  fly(warrior, 120, (i) => {
    most = Math.max(most, warrior.flaps.filter((left) => left > 0).length);
    return i % 8 === 0 ? PRESS : HELD;
  });
  assert.equal(most, 3);
  assert.ok(warrior.y < 150 * S);
  const queen = unit("queen", 100, FLOOR, { ground: 0 });
  fly(queen, 30, (i) =>
    control({ down: true, pressed: i === 5 || i === 15, held: true }),
  );
  assert.equal(queen.diving, false);
  assert.ok(queen.y < FLOOR * S);
});
