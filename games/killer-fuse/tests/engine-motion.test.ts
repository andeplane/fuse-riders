import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK_BUFFER,
  CEILING_BOUNCE_MAX,
  COLLIDERS,
  COYOTE_STEPS,
  DASH_DROP,
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
  QUEEN_DASH,
  QUEEN_HEIGHT,
  QUEEN_LETHAL,
  QUEEN_PERIOD,
  RUN_SPEED,
  S,
  STUN_SPEED,
  TAKEOFF_STEPS,
  TAKEOFF_THRUST,
  UNIT,
  WARRIOR_DASH,
  WARRIOR_HALF,
  WARRIOR_HEIGHT,
  WARRIOR_LETHAL,
  WARRIOR_PERIOD,
  WIDTH,
  WING_WALK_SPEED,
  WORKER_GRAVITY,
  WORKER_GRAVITY_LEDGE,
  WORKER_HALF,
  WORKER_HEIGHT,
  WORKER_TERMINAL,
  colliderOf,
  createRound,
  halfOf,
  heightOf,
  hitBoxesOf,
  lethal,
  moveUnit,
  speedy,
  weaponOf,
  HIT_BOXES,
  WEAPONS,
  type Arena,
  type Input,
  type Rect,
  type Unit,
} from "../src/engine/index.js";
import {
  approach,
  dirOf,
  endDash,
  fits,
  moveBody,
  sheathe,
  steer,
} from "../src/engine/motion.js";
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
    { kind, x: x * S, y: y * S, ground: -1, vx: 0, vy: 0, facing: 1 },
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
  moveUnit(worker, NEUTRAL, FLAT);
  assert.equal(worker.vy, WORKER_GRAVITY);
  fly(worker, 60, () => NEUTRAL);
  assert.equal(worker.ground, 0);
  assert.equal(worker.y, FLOOR * S);
  assert.equal(worker.vy, 0);
  // A long fall is capped at 11.3 u/s.
  const high = unit("worker", 100, -2000);
  fly(high, 60, () => NEUTRAL, arena(rect(0, 9000, 480, 10)));
  assert.equal(high.vy, WORKER_TERMINAL);
});

test("a Worker runs at 7 u/s, turns to face its direction and stops dead when the stick is released", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  fly(worker, 20, () => RIGHT);
  assert.equal(worker.vx, RUN_SPEED);
  assert.equal(worker.facing, 1);
  const from = worker.x;
  fly(worker, 60, () => RIGHT);
  // 7 units of 11 px in a second.
  assert.ok(Math.abs(worker.x - from - 77 * S) < S);
  fly(worker, 10, () => LEFT);
  assert.equal(worker.facing, -1);
  moveUnit(worker, NEUTRAL, FLAT);
  assert.equal(worker.vx, 0);
  assert.equal(dirOf(control({ left: true, right: true })), 0);
});

test("the screen wraps horizontally in both directions", () => {
  const worker = unit("worker", 2, FLOOR, { ground: 0 });
  fly(worker, 30, () => LEFT);
  assert.ok(worker.x > WIDTH - 40 * S && worker.x < WIDTH);
  fly(worker, 60, () => RIGHT);
  assert.ok(worker.x < 50 * S);
});

/** The peak of a jump in units, its apex step and its steps in the air, with the button let go after `hold` steps. */
function jumpOf(hold: number): { peak: number; apex: number; air: number } {
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  let top = worker.y,
    apex = 0,
    air = 0;
  for (let i = 0; i < 120; i += 1) {
    moveUnit(worker, control({ pressed: i === 0, held: i < hold }), FLAT);
    if (worker.y < top) {
      top = worker.y;
      apex = i + 1;
    }
    if (worker.ground < 0) air = i + 1;
  }
  return { peak: (FLOOR * S - top) / UNIT, apex, air };
}

test("a Worker's jump height follows how long the button is held, as Killer Queen Black's does", () => {
  // Release step -> peak in units; each within 6 % of the original.
  const wanted: readonly (readonly [number, number])[] = [
    [1, 0.86],
    [3, 1.32],
    [4, 2.11],
    [8, 3.05],
    [12, 3.46],
    [200, 3.83],
  ];
  for (const [hold, peak] of wanted) {
    const got = jumpOf(hold).peak;
    assert.ok(
      Math.abs(got - peak) <= peak * 0.06,
      `released on step ${hold}: ${got.toFixed(3)} u, wanted ${peak}`,
    );
  }
  // Longer holds never jump lower.
  let last = 0;
  for (let hold = 1; hold <= 45; hold += 1) {
    const { peak } = jumpOf(hold);
    assert.ok(peak >= last, `hold ${hold}`);
    last = peak;
  }
  // A full jump tops out about 0.38 s in and lasts about 0.8 s.
  const full = jumpOf(200);
  assert.ok(full.apex >= 21 && full.apex <= 25, `apex step ${full.apex}`);
  assert.ok(full.air >= 45 && full.air <= 51, `air ${full.air} steps`);
});

test("a jump launches at 14 u/s, and there is no jump in the air", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  moveUnit(worker, control({ pressed: true, held: true }), FLAT);
  // The hold push keeps the launch speed against gravity.
  assert.equal(worker.vy, -JUMP_SPEED);
  assert.equal(worker.flapped, true);
  assert.equal(worker.jumping, true);
  assert.equal(worker.jumpStep, 2);
  moveUnit(worker, NEUTRAL, FLAT);
  assert.equal(worker.jumping, false);
  assert.ok(worker.vy > -JUMP_SPEED);
  const before = worker.vy;
  moveUnit(worker, control({ pressed: true, held: true }), FLAT);
  assert.equal(worker.vy, before + WORKER_GRAVITY);
  assert.equal(worker.flapped, false);
  // Let go in the later part of the hold: the push fades over two steps.
  const late = unit("worker", 100, FLOOR, { ground: 0 });
  fly(late, 6, (i) => control({ pressed: i === 0, held: true }));
  moveUnit(late, NEUTRAL, FLAT);
  assert.equal(late.jumpStep, -1);
  moveUnit(late, NEUTRAL, FLAT);
  assert.equal(late.jumpStep, 0);
});

test("a Worker may still jump for three steps after walking off a ledge, and falls more softly", () => {
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
    assert.equal(worker.light, true);
    return worker;
  };
  assert.equal(COYOTE_STEPS, 3);
  const quick = walkOff();
  const falling = quick.vy;
  moveUnit(quick, RIGHT, ledge);
  assert.equal(quick.vy, falling + WORKER_GRAVITY_LEDGE);
  moveUnit(quick, control({ right: true, pressed: true, held: true }), ledge);
  assert.ok(quick.vy < 0);
  assert.equal(quick.coyote, 0);
  assert.equal(quick.light, false);
  const late = walkOff();
  for (let i = 0; i < COYOTE_STEPS; i += 1) moveUnit(late, RIGHT, ledge);
  moveUnit(late, control({ right: true, pressed: true, held: true }), ledge);
  assert.ok(late.vy > 0);
});

test("a speed Worker runs 1.3 times as fast", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0, speed: true });
  fly(worker, 20, () => RIGHT);
  assert.equal(worker.vx, speedy(RUN_SPEED, true));
  assert.equal(speedy(2000, true), 2600);
  assert.equal(speedy(2000, false), 2000);
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

test("a Warrior walks at 5.6 u/s, flies at 6 u/s and glides on when it lets go", () => {
  const warrior = unit("warrior", 100, FLOOR, { ground: 0 });
  fly(warrior, 90, () => RIGHT);
  assert.equal(warrior.vx, WING_WALK_SPEED);
  moveUnit(warrior, NEUTRAL, FLAT);
  assert.equal(
    warrior.vx,
    WING_WALK_SPEED - Math.trunc((WING_WALK_SPEED * 4) / 15),
  );
  fly(warrior, 20, () => NEUTRAL);
  assert.equal(warrior.vx, 0);
  assert.equal(warrior.ground, 0);
  const flyer = airborne();
  fly(flyer, 40, () => RIGHT, DEEP);
  assert.equal(flyer.vx, FLY_SPEED);
  assert.ok(Math.abs((FLY_SPEED * 60) / S - 66) < 0.1);
  // In the air it glides: 40 steps later it still has a quarter of its speed.
  fly(flyer, 40, () => NEUTRAL, DEEP);
  assert.ok(flyer.vx > FLY_SPEED / 5 && flyer.vx < FLY_SPEED / 3);
  const fast = airborne({ speed: true });
  fly(fast, 40, () => LEFT, DEEP);
  assert.equal(fast.vx, -speedy(FLY_SPEED, true));
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

test("flaps overlap and add up, five at most, and the climb is capped at 10 u/s", () => {
  const flyer = airborne();
  moveUnit(flyer, PRESS, DEEP);
  moveUnit(flyer, PRESS, DEEP);
  assert.equal(flyer.vy, 2 * FLY_GRAVITY - 3 * FLAP_THRUST);
  fly(flyer, MAX_FLAPS - 2, () => PRESS, DEEP);
  assert.equal(flyer.flaps.filter((left) => left > 0).length, MAX_FLAPS);
  // A sixth press while five run is lost.
  moveUnit(flyer, PRESS, DEEP);
  assert.equal(flyer.flapped, false);
  fly(flyer, 8, () => NEUTRAL, DEEP);
  assert.equal(flyer.vy, -FLY_MAX_RISE);
  assert.ok(Math.abs((FLY_MAX_RISE * 60) / UNIT - 10) < 0.01);
  // A speed gate lets a Warrior climb 1.15 times as fast; a Queen never has one.
  const fast = airborne({ speed: true });
  fly(fast, 14, () => PRESS, DEEP);
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
  assert.ok(table[3] > 380 && table[3] < 470, `3 Hz ${table[3]}`);
  assert.ok(table[4] > 500, `4 Hz ${table[4]}`);
  // Mashing gains little over four a second: the climb is capped at 110 px/s.
  assert.ok(table[6] >= table[4] && table[6] <= 550, `6 Hz ${table[6]}`);
  assert.equal(HOVER_HZ, 3);
});

test("after a take-off gravity is weaker until the next landing: fewer presses hold a height", () => {
  assert.ok(climb(30, 5, { light: true }) > 0);
  assert.ok(climb(30, 5) < 0);
  assert.ok(climb(40, 5, { light: true }) < 0);
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

test("the top of the screen is a ceiling: a Queen stops at it, a Warrior bounces off at 4 u/s at most", () => {
  const queen = unit("queen", 100, 60);
  fly(queen, 120, (i) => (i % 6 === 0 ? PRESS : NEUTRAL));
  assert.equal(queen.y, COLLIDERS.queenFly.height);
  assert.equal(queen.vy, 0);
  fly(queen, 60, (i) => (i % 6 === 0 ? PRESS : NEUTRAL));
  assert.equal(queen.y, COLLIDERS.queenFly.height);
  const warrior = unit("warrior", 100, 20, { vy: -FLY_MAX_RISE });
  warrior.flaps.fill(FLAP_STEPS);
  let bounced = 0;
  for (let i = 0; i < 20 && bounced === 0; i += 1) {
    moveUnit(warrior, NEUTRAL, FLAT);
    if (warrior.y === WARRIOR_HEIGHT) bounced = warrior.vy;
  }
  assert.equal(bounced, CEILING_BOUNCE_MAX);
  // A slow touch keeps 0.6 of its speed.
  const slow = unit("warrior", 100, 16, { vy: -1000 - FLY_GRAVITY });
  slow.y = WARRIOR_HEIGHT + 100;
  moveUnit(slow, NEUTRAL, FLAT);
  assert.equal(slow.y, WARRIOR_HEIGHT);
  assert.equal(slow.vy, 600);
});

test("a stunned unit cannot steer, flap, jump or turn, and drifts at 10 u/s at most", () => {
  const flyer = airborne({ stun: 3, vx: 3 * STUN_SPEED, facing: 1 });
  fly(flyer, 3, () => control({ left: true, pressed: true, held: true }), DEEP);
  assert.equal(flyer.flapped, false);
  assert.equal(flyer.vy, 3 * FLY_GRAVITY);
  assert.equal(flyer.stun, 0);
  assert.equal(flyer.facing, 1);
  assert.ok(flyer.vx > 0 && flyer.vx < STUN_SPEED);
  assert.ok(flyer.vx > STUN_SPEED - Math.trunc(STUN_SPEED / 10));
  // The press was remembered and fires when the stun ends.
  moveUnit(flyer, NEUTRAL, DEEP);
  assert.equal(flyer.flapped, true);
  const grounded = unit("warrior", 100, FLOOR, { ground: 0, stun: 5 });
  moveUnit(grounded, PRESS, FLAT);
  assert.equal(grounded.ground, 0);
  const worker = unit("worker", 100, FLOOR, {
    ground: 0,
    stun: 2,
    vx: -3 * STUN_SPEED,
    regular: true,
  });
  moveUnit(worker, control({ right: true, pressed: true, held: true }), FLAT);
  assert.equal(worker.jumping, false);
  assert.equal(worker.vx, -STUN_SPEED + Math.trunc(STUN_SPEED / 60));
  moveUnit(worker, NEUTRAL, FLAT);
  assert.equal(worker.stun, 0);
  assert.equal(worker.regular, false);
});

test("a Queen's dive starts on the down press in the air at 20 u/s at once and ends on release", () => {
  const queen = unit("queen", 100, HIGH, { vy: -FLY_MAX_RISE });
  queen.flaps[0] = 9;
  const dive = control({ down: true, right: true });
  moveUnit(queen, dive, DEEP);
  assert.equal(queen.diving, true);
  // No onset: the climb is gone and she falls at the full speed on the first step.
  assert.equal(queen.vy, DIVE_SPEED);
  assert.ok(Math.abs((DIVE_SPEED * 60) / UNIT - 20) < 0.01);
  assert.equal(queen.y, HIGH * S + DIVE_SPEED);
  assert.deepEqual(queen.flaps, [0, 0, 0, 0, 0]);
  assert.equal(lethal(queen), true);
  assert.equal(weaponOf(queen), WEAPONS.queenDive);
  assert.equal(hitBoxesOf(queen), HIT_BOXES.queenDive);
  // A press does nothing while diving, and she steers quickly.
  fly(queen, 12, () => ({ ...dive, pressed: true, held: true }), DEEP);
  assert.equal(queen.flapped, false);
  assert.equal(queen.vy, DIVE_SPEED);
  assert.equal(queen.vx, FLY_SPEED);
  moveUnit(queen, RIGHT, DEEP);
  assert.equal(queen.diving, false);
  assert.equal(queen.vy, FLY_TERMINAL);
  assert.equal(lethal(queen), false);
  // No cooldown: she may dive again on the next press.
  moveUnit(queen, dive, DEEP);
  assert.equal(queen.diving, true);
});

test("a dive ends on landing, needs a new press, and only a Queen in the air and not glanced can dive", () => {
  const queen = unit("queen", 100, FLOOR - 60);
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
  // A glance stun blocks the dive; a bump stun does not.
  const glanced = unit("queen", 100, 100, { stun: 5, regular: true });
  moveUnit(glanced, down, FLAT);
  assert.equal(glanced.diving, false);
  const bumped = unit("queen", 100, 100, { stun: 5 });
  moveUnit(bumped, down, FLAT);
  assert.equal(bumped.diving, true);
});

test("a dive that clips a platform corner slides past it when she is barely moving sideways", () => {
  const ledge = arena(rect(200, 200, 60, 6));
  const half = COLLIDERS.queenFly.half;
  // Two pixels of her box are over the platform's left end.
  const clip = (vx: number): Unit => {
    const queen = unit("queen", 0, 150, { vx });
    queen.x = 200 * S - half + 2 * S;
    fly(queen, 40, () => control({ down: true }), ledge);
    return queen;
  };
  const slid = clip(0);
  assert.equal(slid.ground, 0);
  assert.equal(slid.y, FLOOR * S);
  assert.ok(slid.x <= 200 * S - half);
  // Deeper over the edge she lands on it.
  const landed = unit("queen", 0, 150);
  landed.x = 200 * S - half + 5 * S;
  fly(landed, 30, () => control({ down: true }), ledge);
  assert.equal(landed.ground, 1);
  // Clipping the right end slides the other way.
  const right = unit("queen", 0, 150);
  right.x = 260 * S + half - 2 * S;
  fly(right, 40, () => control({ down: true }), ledge);
  assert.equal(right.ground, 0);
  assert.ok(right.x >= 260 * S + half);
  // Moving sideways fast there is no nudge.
  const fast = unit("queen", 0, 198, { vx: FLY_SPEED, diving: true });
  fast.x = 200 * S - half + S;
  fast.downHeld = true;
  moveUnit(fast, control({ down: true, right: true }), ledge);
  assert.equal(fast.ground, 1);
});

test("walls stop a unit from either side, a platform above stops a jump, and a flying Warrior bounces off a wall", () => {
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
  assert.equal(under.jumping, false);
  // Restitution 0.6 for a Warrior in the air, none for a Queen or a walker.
  const warrior = unit("warrior", 190, 230, { vx: FLY_SPEED });
  let hit = 0;
  for (let i = 0; i < 10 && hit === 0; i += 1) {
    moveUnit(warrior, RIGHT, pillar);
    if (warrior.vx < 0) hit = warrior.vx;
  }
  assert.equal(hit, -Math.trunc((FLY_SPEED * 3) / 5));
  const queen = unit("queen", 190, 230, { vx: FLY_SPEED });
  fly(queen, 20, () => RIGHT, pillar);
  assert.equal(queen.x, 200 * S - halfOf("queen"));
  assert.equal(queen.vx, 0);
});

test("a wall that ends at the screen edge also stops a unit coming across the wrap", () => {
  const edge = arena(rect(460, 200, 20, 65));
  const worker = unit("worker", 12, FLOOR, { ground: 0 });
  fly(worker, 40, () => LEFT, edge);
  assert.equal(worker.x, WORKER_HALF);
  const body = { x: 478 * S, y: 100 * S, vx: 4 * S, vy: 0 };
  const box = { half: 3 * S, height: 6 * S, lift: 0, shift: 0 };
  const contact = moveBody(body, box, 1, edge);
  assert.deepEqual(contact, { wall: -1, ceiling: false, ground: -1 });
  assert.equal(body.x, 2 * S);
  // The contact names the wall it ran into.
  const blocked = { x: 455 * S, y: 240 * S, vx: 4 * S, vy: 0 };
  assert.equal(moveBody(blocked, box, 1, edge).wall, 1);
  assert.equal(blocked.x, 457 * S);
  // A shifted, lifted box is placed by its own sides and bottom.
  const lifted = { half: 3 * S, height: 6 * S, lift: 4 * S, shift: 2 * S };
  const low = { x: 100 * S, y: 266 * S, vx: 0, vy: 4 * S };
  assert.equal(moveBody(low, lifted, -1, edge).ground, 0);
  assert.equal(low.y, (FLOOR + 4) * S);
  assert.equal(fits(edge, 100 * S, 268 * S, lifted, 1), true);
  assert.equal(fits(edge, 100 * S, 270 * S, lifted, 1), false);
  assert.equal(fits(edge, 100 * S, 5 * S, box, 1), false);
  assert.equal(fits(edge, 456 * S, 240 * S, lifted, 1), false);
  assert.equal(fits(edge, 456 * S, 240 * S, lifted, -1), true);
});

test("body sizes and the approach helper", () => {
  // Black's boxes at 11 px a unit: a Worker is 6 by 13, a Warrior 6 by 16, a Queen 5 by 21 standing.
  const size = (kind: Unit["kind"]): [number, number] => [
    Math.round((2 * halfOf(kind)) / S),
    Math.round(heightOf(kind) / S),
  ];
  assert.deepEqual(size("worker"), [6, 13]);
  assert.deepEqual(size("warrior"), [6, 16]);
  assert.deepEqual(size("queen"), [5, 21]);
  assert.equal(heightOf("warrior"), WARRIOR_HEIGHT);
  assert.equal(heightOf("queen"), QUEEN_HEIGHT);
  assert.equal(approach(0, 10, 4), 4);
  assert.equal(approach(8, 10, 4), 10);
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(approach(2, 0, 4), 0);
});

test("a Queen is shorter in the air, and under a low ceiling she keeps the box she flew in with", () => {
  const queen = unit("queen", 100, FLOOR, { ground: 0 });
  assert.equal(colliderOf(queen), COLLIDERS.queen);
  queen.ground = -1;
  assert.equal(colliderOf(queen), COLLIDERS.queenFly);
  // A gap of 19 px: taller than the flying box (16.5), lower than the standing one (21).
  const low = arena(rect(80, FLOOR - 19 - 6, 60, 6));
  const crawler = unit("queen", 100, FLOOR, { ground: 0 });
  fly(crawler, 120, () => RIGHT, low);
  assert.ok(crawler.x > 145 * S, "walked out from under the ledge");
  assert.equal(crawler.ground, 0);
  assert.equal(crawler.y, FLOOR * S);
  // Standing tall outside, she does not fit under it.
  fly(crawler, 120, () => LEFT, low);
  assert.equal(crawler.x, 140 * S + halfOf("queen"));
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  assert.equal(colliderOf(worker), COLLIDERS.worker);
  assert.equal(hitBoxesOf(worker), HIT_BOXES.workerStand);
  worker.vx = 5;
  assert.equal(hitBoxesOf(worker), HIT_BOXES.workerMove);
  worker.riding = true;
  assert.equal(hitBoxesOf(worker), HIT_BOXES.workerRide);
  assert.equal(lethal(worker), false);
  assert.deepEqual(weaponOf(worker), []);
  const warrior = unit("warrior", 100, FLOOR, { ground: 0 });
  assert.equal(hitBoxesOf(warrior), HIT_BOXES.warriorStand);
  warrior.ground = -1;
  warrior.vy = -5;
  assert.equal(hitBoxesOf(warrior), HIT_BOXES.warriorRise);
  warrior.vy = 5;
  assert.equal(hitBoxesOf(warrior), HIT_BOXES.warriorFall);
  assert.equal(hitBoxesOf(queen), HIT_BOXES.queenFly);
  queen.ground = 0;
  assert.equal(hitBoxesOf(queen), HIT_BOXES.queenStand);
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

// --- The sword ------------------------------------------------------------------------------------------------------

const ATTACK = control({ attack: true });

/** The steps (1 on the press) on which the unit's weapon is lethal, and the step on which a held-down press starts the next attack. */
function swing(kind: "warrior" | "queen"): { lethal: number[]; next: number } {
  const fighter = unit(kind, 100, HIGH);
  const steps: number[] = [];
  let next = 0;
  for (let step = 1; step <= 60 && next === 0; step += 1) {
    // Pressing on every step: only the first press and the first one after the period take.
    moveUnit(fighter, ATTACK, DEEP);
    if (step > 1 && fighter.attack === 1) next = step;
    else if (lethal(fighter)) steps.push(step);
  }
  return { lethal: steps, next };
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

test("a Warrior's sword is lethal on steps 1 to 19 and its next attack starts on step 45", () => {
  assert.deepEqual([WARRIOR_LETHAL, WARRIOR_PERIOD], [19, 44]);
  const { lethal: steps, next } = swing("warrior");
  assert.deepEqual(steps, range(1, 19));
  assert.equal(next, 45);
});

test("a Queen's dash is lethal on steps 1 to 17 and her next attack starts on step 37", () => {
  assert.deepEqual([QUEEN_LETHAL, QUEEN_PERIOD], [17, 36]);
  const { lethal: steps, next } = swing("queen");
  assert.deepEqual(steps, range(1, 17));
  assert.equal(next, 37);
});

test("a Worker has no attack", () => {
  const worker = unit("worker", 100, FLOOR, { ground: 0 });
  fly(worker, 5, () => ATTACK);
  assert.equal(worker.attack, 0);
  assert.equal(worker.dashing, false);
  assert.equal(worker.attackBuffer, 0);
});

test("an attack press is remembered six steps: it fires when the cooldown ends, and is lost when it came earlier", () => {
  assert.equal(ATTACK_BUFFER, 6);
  const startsAgain = (lead: number): boolean => {
    const warrior = unit("warrior", 100, HIGH);
    // Step 45 is the first on which a new attack may start; the second press comes `lead` steps before it.
    for (let step = 1; step <= 45; step += 1)
      moveUnit(
        warrior,
        step === 1 || step === 45 - lead ? ATTACK : NEUTRAL,
        DEEP,
      );
    return warrior.attack === 1;
  };
  assert.equal(startsAgain(0), true);
  assert.equal(startsAgain(ATTACK_BUFFER), true);
  assert.equal(startsAgain(ATTACK_BUFFER + 1), false);
  // A glance stun blocks the attack; the press waits for it to end. A bump stun does not block it.
  const glanced = unit("warrior", 100, HIGH, { stun: 4, regular: true });
  moveUnit(glanced, ATTACK, DEEP);
  assert.equal(glanced.attack, 0);
  assert.equal(glanced.attackBuffer, ATTACK_BUFFER);
  fly(glanced, 3, () => NEUTRAL, DEEP);
  assert.equal(glanced.attack, 0);
  moveUnit(glanced, NEUTRAL, DEEP);
  assert.equal(glanced.attack, 1);
  const bumped = unit("warrior", 100, HIGH, { stun: 15, vx: -STUN_SPEED });
  moveUnit(bumped, ATTACK, DEEP);
  assert.equal(bumped.attack, 1);
  assert.equal(bumped.dashing, true);
  // Starting the dash clears the stun.
  assert.equal(bumped.stun, 0);
});

test("a Warrior's dash sets its speed each step, 20 u/s easing to 15, and carries it 5 u", () => {
  assert.equal(WARRIOR_DASH.length, WARRIOR_LETHAL);
  assert.ok(Math.abs((WARRIOR_DASH[0]! * 60) / UNIT - 20) < 0.01);
  assert.ok(Math.abs((WARRIOR_DASH[18]! * 60) / UNIT - 15) < 0.01);
  for (let k = 1; k < WARRIOR_DASH.length; k += 1)
    assert.ok(WARRIOR_DASH[k]! <= WARRIOR_DASH[k - 1]!);
  const warrior = unit("warrior", 100, HIGH, { vx: -FLY_SPEED, facing: -1 });
  const from = warrior.x;
  // The stick opposes the motion, so the dash goes the way it faces; steering does nothing during it.
  moveUnit(warrior, control({ attack: true, right: true }), DEEP);
  assert.equal(warrior.dashing, true);
  assert.equal(warrior.facing, -1);
  assert.equal(warrior.vx, -WARRIOR_DASH[0]!);
  assert.equal(colliderOf(warrior), COLLIDERS.warriorDash);
  assert.equal(hitBoxesOf(warrior), HIT_BOXES.warriorAttack);
  assert.equal(weaponOf(warrior), WEAPONS.warrior);
  for (let step = 2; step <= WARRIOR_LETHAL; step += 1) {
    moveUnit(warrior, RIGHT, DEEP);
    assert.equal(warrior.vx, -WARRIOR_DASH[step - 1]!);
    assert.equal(warrior.facing, -1);
  }
  const reach = (from - warrior.x) / UNIT;
  assert.ok(reach > 5 && reach < 5.2, `dashed ${reach} u`);
  moveUnit(warrior, RIGHT, DEEP);
  assert.equal(warrior.dashing, false);
  assert.equal(warrior.facing, 1);
  // With the stick along the motion, or at rest, the dash goes the held way.
  const turned = unit("warrior", 100, HIGH, { facing: -1 });
  moveUnit(turned, control({ attack: true, right: true }), DEEP);
  assert.equal(turned.facing, 1);
  assert.equal(turned.vx, WARRIOR_DASH[0]!);
  // A speed gate does not change the dash.
  const fast = unit("warrior", 100, HIGH, { speed: true });
  moveUnit(fast, ATTACK, DEEP);
  assert.equal(fast.vx, WARRIOR_DASH[0]!);
});

test("a Queen's dash is a flat 16 u/s in her flat box, and out of a dive she drops 0.8 u first", () => {
  const queen = unit("queen", 100, HIGH);
  moveUnit(queen, ATTACK, DEEP);
  assert.equal(queen.dashing, true);
  assert.equal(queen.vx, QUEEN_DASH);
  assert.ok(Math.abs((QUEEN_DASH * 60) / UNIT - 16) < 0.01);
  assert.equal(colliderOf(queen), COLLIDERS.queenDash);
  assert.equal(hitBoxesOf(queen), HIT_BOXES.queenDash);
  assert.equal(weaponOf(queen), WEAPONS.queenDash);
  fly(queen, QUEEN_LETHAL - 1, () => NEUTRAL, DEEP);
  assert.equal(queen.vx, QUEEN_DASH);
  assert.equal(queen.dashing, true);
  moveUnit(queen, NEUTRAL, DEEP);
  assert.equal(queen.dashing, false);
  assert.ok(queen.vx < QUEEN_DASH);
  const diver = unit("queen", 100, HIGH);
  moveUnit(diver, control({ down: true }), DEEP);
  const y = diver.y;
  moveUnit(diver, control({ down: true, attack: true }), DEEP);
  assert.equal(diver.diving, false);
  assert.equal(diver.dashing, true);
  // The drop, then the step's own fall.
  assert.equal(diver.y, y + DASH_DROP + diver.vy);
  // Just above a floor there is no room to drop: she dashes from where she is.
  const low = unit("queen", 100, FLOOR - 4, { diving: true, downHeld: true });
  moveUnit(low, control({ down: true, attack: true }), FLAT);
  assert.equal(low.dashing, true);
  assert.ok(low.y <= FLOOR * S + COLLIDERS.queenDash.lift);
});

test("a dash arcs: gravity pulls it down and a flap during it lifts it", () => {
  const plain = airborne(),
    flapped = airborne();
  fly(plain, WARRIOR_LETHAL, (i) => (i === 0 ? ATTACK : NEUTRAL), DEEP);
  fly(
    flapped,
    WARRIOR_LETHAL,
    (i) => control({ attack: i === 0, pressed: i === 1 || i === 3 }),
    DEEP,
  );
  // Without a flap it has fallen about 2 u by the end; two flaps hold it up.
  const fell = (plain.y - HIGH * S) / UNIT;
  assert.ok(fell > 1.8 && fell < 2.6, `fell ${fell} u`);
  assert.equal(plain.vy, FLY_TERMINAL);
  assert.ok(flapped.y < HIGH * S, "the flapped dash rose");
  assert.equal(flapped.x, plain.x);
  assert.equal(flapped.dashing, true);
  // A dash from the ground runs along it, and a take-off during it lifts it off.
  const runner = unit("warrior", 100, FLOOR, { ground: 0 });
  fly(runner, 10, (i) => (i === 0 ? ATTACK : NEUTRAL));
  assert.equal(runner.dashing, true);
  assert.equal(runner.ground, 0);
  assert.equal(runner.vx, WARRIOR_DASH[9]!);
  moveUnit(runner, PRESS, FLAT);
  assert.equal(runner.ground, -1);
  assert.equal(runner.dashing, true);
});

test("a dash into a wall within the wall's height ends: a Warrior stays lethal to the end of its window, a Queen cools down at once", () => {
  const pillar = arena(rect(200, 150, 20, 115));
  const warrior = unit("warrior", 170, 230);
  let ended = 0;
  for (let step = 1; step <= 12 && ended === 0; step += 1) {
    moveUnit(warrior, step === 1 ? ATTACK : NEUTRAL, pillar);
    if (!warrior.dashing) ended = step;
  }
  assert.ok(ended > 1 && ended < 12, `ended on step ${ended}`);
  assert.equal(warrior.x, 200 * S - WARRIOR_HALF);
  assert.equal(lethal(warrior), true);
  // In the air a Warrior bounces off the wall.
  assert.ok(warrior.vx < 0);
  fly(warrior, WARRIOR_LETHAL - ended, () => NEUTRAL, pillar);
  assert.equal(lethal(warrior), true);
  moveUnit(warrior, NEUTRAL, pillar);
  assert.equal(lethal(warrior), false);
  assert.equal(warrior.attack, WARRIOR_LETHAL + 1);

  const queen = unit("queen", 160, 230);
  ended = 0;
  for (let step = 1; step <= 16 && ended === 0; step += 1) {
    moveUnit(queen, step === 1 ? ATTACK : NEUTRAL, pillar);
    if (!queen.dashing) ended = step;
  }
  assert.ok(ended > 1 && ended < 16, `ended on step ${ended}`);
  assert.equal(lethal(queen), false);
  assert.equal(queen.attack, QUEEN_LETHAL + 1);
  assert.equal(queen.vx, 0);
  assert.equal(colliderOf(queen), COLLIDERS.queenFly);
  assert.equal(fits(pillar, queen.x, queen.y, COLLIDERS.queenFly, 1), true);
  // Her cooldown runs from there: the next attack starts 19 steps later, not sooner.
  fly(queen, QUEEN_PERIOD - QUEEN_LETHAL - 1, () => ATTACK, pillar);
  assert.notEqual(queen.attack, 1);
  moveUnit(queen, control({ attack: true, left: true }), pillar);
  assert.equal(queen.attack, 1);
});

const LEDGE = rect(200, 200, 60, 10);

/** Dashes right from x = 170, held level with the feet at `y` subpixels, toward `wall` (and the floor). */
function dashAt(kind: "warrior" | "queen", y: number, wall = LEDGE): Unit {
  const map = arena(wall);
  const fighter = unit(kind, 170, 0);
  fighter.y = y;
  for (let step = 1; step <= 12; step += 1) {
    // Gravity is cancelled so only the wall changes the height.
    fighter.vy = -FLY_GRAVITY;
    moveUnit(fighter, step === 1 ? ATTACK : NEUTRAL, map);
    if (!fighter.dashing) break;
  }
  return fighter;
}

test("a dash that meets a ledge: a Queen sticking out above is lifted onto it, a Warrior's dash ends", () => {
  // The Queen's flat box is 4.2 px tall, its bottom 7.4 px above her feet: here its top is above the ledge top.
  const lift = COLLIDERS.queenDash.lift;
  const queen = dashAt("queen", 201 * S + lift);
  assert.equal(queen.dashing, true);
  assert.equal(queen.y, 200 * S + lift);
  assert.ok(queen.x > 200 * S);
  // A Warrior sticking out above the ledge stops against it.
  const warrior = dashAt("warrior", 205 * S);
  assert.equal(warrior.dashing, false);
  assert.equal(warrior.x, 200 * S - WARRIOR_HALF);
  assert.equal(lethal(warrior), true);
});

test("a dash that meets the underside of a wall: a Queen slips under, a Warrior only when its lower quarter is below the wall's middle", () => {
  const lift = COLLIDERS.queenDash.lift;
  // Her box bottom is one pixel below the wall's bottom (210).
  const queen = dashAt("queen", 211 * S + lift);
  assert.equal(queen.dashing, true);
  assert.equal(queen.y, 210 * S + COLLIDERS.queenDash.height + lift);
  assert.ok(queen.x > 200 * S);
  // A Warrior's dash box is 12.5 px tall, so its lower quarter is 3.1 px. Against a platform 6 px thick (middle 203,
  // bottom 206): with its bottom at 207 the quarter starts at 203.9 and it slips under.
  const thin = rect(200, 200, 60, 6);
  const box = COLLIDERS.warriorDash;
  const under = dashAt("warrior", 207 * S + box.lift, thin);
  assert.equal(under.dashing, true);
  assert.equal(under.y, 206 * S + box.height + box.lift);
  assert.ok(under.x > 200 * S);
  // With its bottom a hair below the platform's the quarter starts above the middle: the dash ends.
  const caught = dashAt("warrior", 206 * S + 50 + box.lift, thin);
  assert.equal(caught.dashing, false);
  assert.equal(caught.x, 200 * S - WARRIOR_HALF);
  // No room under the wall (5 px to the floor): the dash ends as well.
  const tight = dashAt("warrior", 261 * S + box.lift, rect(200, 240, 60, 20));
  assert.equal(tight.dashing, false);
  assert.equal(tight.x, 200 * S - WARRIOR_HALF);
});

test("ending a dash by hand: a Queen goes to her cooldown, a sheathed sword stops being lethal, a finished dash is left alone", () => {
  const queen = unit("queen", 100, HIGH);
  moveUnit(queen, ATTACK, DEEP);
  endDash(queen, DEEP);
  assert.equal(queen.dashing, false);
  assert.equal(queen.attack, QUEEN_LETHAL + 1);
  endDash(queen, DEEP);
  assert.equal(queen.attack, QUEEN_LETHAL + 1);
  const warrior = unit("warrior", 100, HIGH);
  moveUnit(warrior, ATTACK, DEEP);
  endDash(warrior, DEEP);
  assert.equal(lethal(warrior), true);
  sheathe(warrior, DEEP);
  assert.equal(lethal(warrior), false);
  assert.equal(warrior.attack, WARRIOR_LETHAL + 1);
  const diver = unit("queen", 100, HIGH, { diving: true });
  sheathe(diver, DEEP);
  assert.equal(diver.diving, false);
  assert.equal(diver.attack, 0);
});

test("a Queen with no room for her flat box cannot dash, and one whose dash ends in a tight spot is put in the clear", () => {
  // A shaft 12 px wide: her dash box is 18.6 px long.
  const shaft = arena(rect(180, 100, 14, 165), rect(206, 100, 14, 165));
  const stuck = unit("queen", 200, 240);
  moveUnit(stuck, ATTACK, shaft);
  assert.equal(stuck.dashing, false);
  assert.equal(stuck.attack, 0);
  assert.equal(stuck.attackBuffer, ATTACK_BUFFER);
  // Close to a wall behind her she shifts forward to fit.
  const wall = arena(rect(180, 100, 14, 165));
  const near = unit("queen", 0, 240);
  near.x = 194 * S + COLLIDERS.queenFly.half;
  const x = near.x;
  moveUnit(near, ATTACK, wall);
  assert.equal(near.dashing, true);
  assert.ok(near.x > x + QUEEN_DASH);
  // Dashing along the floor her feet are below it; when the dash ends she stands back on it.
  const runner = unit("queen", 100, FLOOR, { ground: 0 });
  fly(runner, QUEEN_LETHAL + 1, (i) => (i === 0 ? ATTACK : NEUTRAL));
  assert.equal(runner.dashing, false);
  assert.equal(
    fits(FLAT, runner.x, runner.y, colliderOf(runner, false), 1),
    true,
  );
  fly(runner, 30, () => NEUTRAL);
  assert.equal(runner.ground, 0);
  assert.equal(runner.y, FLOOR * S);
});
