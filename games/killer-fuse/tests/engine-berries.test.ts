import test from "node:test";
import assert from "node:assert/strict";
import {
  BERRY_HEIGHT,
  DEPOSIT_EXIT,
  DEPOSIT_POP_X,
  DEPOSIT_POP_Y,
  DEPOSIT_STEPS,
  GATE_INVULN,
  KICK_LIFT,
  KICK_WAIT,
  MAPS,
  S,
  TICK_HZ,
  UNIT,
  WORKER_HEIGHT,
  arenaOf,
  stepRound,
  type LooseBerry,
  type Round,
  type Unit,
} from "../src/engine/index.js";
import { holeOpen, stepBerries } from "../src/engine/berries.js";
import { resolveCombat } from "../src/engine/combat.js";
import { bare, ofType, put, run, stand, unitOf } from "./engine-kit.js";

const MAP = MAPS[1];
const FLOOR = 265;
/** A point on the open floor with nothing above it for a Worker to touch. */
const OPEN = 300;

function pileOnFloor(): { index: number; x: number } {
  const index = MAP.piles.findIndex((pile) => pile.y === FLOOR);
  const pile = MAP.piles[index];
  assert.ok(pile);
  return { index, x: pile.x };
}

/** Hangs a carrying Worker in the air with its body centred on a hive hole, so that it touches that hole alone. */
function atHole(state: Round, slot: number, team: 0 | 1, index: number): Unit {
  const at = MAP.holes[team][index];
  assert.ok(at);
  return put(state, slot, at.x, at.y + 6, { carrying: true });
}

function loose(state: Round, x: number, y: number, by = 3): LooseBerry {
  const berry: LooseBerry = {
    x: x * S,
    y: y * S,
    vx: 0,
    vy: 0,
    resting: false,
    wait: 0,
    by,
  };
  state.loose.push(berry);
  return berry;
}

test("a Worker takes one berry from a pile by touching it, and no second one while carrying", () => {
  const state = bare();
  const pile = pileOnFloor();
  const worker = stand(state, 2, pile.x, FLOOR);
  const before = state.piles[pile.index] ?? 0;
  const events = run(state, 5);
  assert.deepEqual(events, [
    { type: "berryPickup", slot: 2, pile: pile.index },
  ]);
  assert.equal(worker.carrying, true);
  assert.equal(state.piles[pile.index], before - 1);
});

test("an empty pile gives nothing, and Warriors and Queens do not gather", () => {
  const state = bare();
  const pile = pileOnFloor();
  stand(state, 2, pile.x, FLOOR, { kind: "warrior" });
  stand(state, 0, pile.x + 4, FLOOR);
  assert.deepEqual(run(state, 3), []);
  const empty = bare();
  empty.piles[pile.index] = 0;
  const worker = stand(empty, 2, pile.x, FLOOR);
  run(empty, 3);
  assert.equal(worker.carrying, false);
});

test("every pile holds six berries and none grows back", () => {
  for (const map of [MAPS[1], MAPS[2], MAPS[3]])
    assert.deepEqual(
      map.piles.map((pile) => pile.count),
      map.piles.map(() => 6),
    );
  const state = bare();
  state.piles.fill(0);
  assert.deepEqual(run(state, 600), []);
  assert.deepEqual(
    state.piles,
    state.piles.map(() => 0),
  );
});

test("banking: the Worker climbs into an open hole of its own hive, the berry counts 1.5 s later, and it pops out after 0.56 s more, briefly invulnerable", () => {
  assert.deepEqual([DEPOSIT_STEPS, DEPOSIT_EXIT], [90, 34]);
  const state = bare();
  const worker = atHole(state, 2, 0, 0);
  worker.facing = -1;
  const hole = arenaOf(1).holes[0][0];
  assert.ok(hole);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "depositStart", slot: 2, team: 0, hole: 0 },
  ]);
  assert.equal(worker.deposit, 0);
  assert.equal(worker.carrying, true);
  assert.deepEqual(
    [worker.x, worker.y],
    [hole.x, hole.y + Math.trunc(WORKER_HEIGHT / 2)],
  );
  // The hole is taken, though not yet filled: no one else can use it.
  assert.equal(holeOpen(state, 0, 0), false);
  assert.equal(state.holes[0]?.[0], false);
  assert.deepEqual(run(state, DEPOSIT_STEPS - 1), []);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "berryDeposit", slot: 2, team: 0, hole: 0 },
  ]);
  assert.equal(worker.carrying, false);
  assert.equal(state.holes[0]?.[0], true);
  assert.deepEqual(run(state, DEPOSIT_EXIT - 1), []);
  assert.equal(worker.deposit, 0);
  // It has not moved all the while.
  assert.equal(worker.x, hole.x);
  stepRound(state, []);
  assert.equal(worker.deposit, -1);
  assert.equal(worker.facing, 1);
  assert.deepEqual([worker.vx, worker.vy], [DEPOSIT_POP_X, -DEPOSIT_POP_Y]);
  assert.equal(DEPOSIT_POP_X, Math.round((2 * UNIT) / TICK_HZ));
  assert.equal(DEPOSIT_POP_Y, Math.round((5 * UNIT) / TICK_HZ));
  assert.equal(worker.invuln, GATE_INVULN);
  stepRound(state, []);
  assert.ok(worker.x > hole.x && worker.y < hole.y + WORKER_HEIGHT / 2);
});

test("a Worker in a hole cannot be killed or bumped, and a full or taken hole, or the enemy's hive, takes nothing", () => {
  const state = bare();
  const worker = atHole(state, 2, 0, 0);
  stepRound(state, []);
  put(state, 3, worker.x / S - 6, worker.y / S, {
    kind: "warrior",
    attack: 3,
    dashing: true,
    facing: 1,
    vx: 400,
  });
  state.events = [];
  resolveCombat(state);
  assert.equal(worker.dead, false);
  assert.deepEqual(state.events, []);
  unitOf(state, 3).dead = true;
  // A teammate at the same hole waits outside it.
  const second = atHole(state, 4, 0, 0);
  stepBerries(state);
  assert.equal(second.deposit, -1);
  run(state, DEPOSIT_STEPS + DEPOSIT_EXIT);
  // Now it is full.
  atHole(state, 4, 0, 0);
  stepBerries(state);
  assert.equal(second.deposit, -1);
  assert.equal(second.carrying, true);
  // An enemy carrier in this hive banks nothing.
  const enemy = atHole(state, 3, 0, 3);
  enemy.kind = "worker";
  Object.assign(enemy, { attack: 0, dashing: false });
  stepBerries(state);
  assert.equal(enemy.deposit, -1);
  assert.equal(enemy.carrying, true);
});

test("a rider banks from the snail's back, getting off it", () => {
  const state = bare();
  const rider = atHole(state, 2, 0, 1);
  rider.riding = true;
  state.snail.rider = 2;
  stepBerries(state);
  assert.equal(rider.deposit, 1);
  assert.equal(rider.riding, false);
  assert.equal(state.snail.rider, -1);
});

test("filling every hole of a hive is an economy victory", () => {
  const state = bare();
  const holes = state.holes[1];
  assert.ok(holes);
  holes.fill(true);
  holes[3] = false;
  atHole(state, 5, 1, 3);
  const events = run(state, DEPOSIT_STEPS + 1);
  assert.deepEqual(state.winner, { team: 1, kind: "economy" });
  assert.deepEqual(
    events.map((event) => event.type),
    ["depositStart", "berryDeposit", "victory"],
  );
});

test("a loose berry falls, bounces and comes to rest", () => {
  const state = bare();
  const berry = loose(state, OPEN, 255);
  berry.vx = 2 * S;
  run(state, 200);
  assert.equal(berry.resting, true);
  assert.equal(berry.y, FLOOR * S);
  assert.equal(berry.vx, 0);
  assert.ok(berry.x > OPEN * S);
  const at = berry.x;
  run(state, 10);
  assert.equal(berry.x, at);
});

test("a loose berry bounces off a wall and stops under a ceiling", () => {
  const state = bare();
  const ledge = MAP.platforms.find(
    (platform) => platform.y === 145 && platform.x === 50,
  );
  assert.ok(ledge);
  const side = loose(state, ledge.x + ledge.w + 4, ledge.y + ledge.h - 1);
  side.vx = -3 * S;
  stepBerries(state);
  assert.ok(side.vx > 0);
  const under = loose(state, ledge.x + 10, ledge.y + ledge.h + 8);
  under.vy = -4 * S;
  stepBerries(state);
  assert.equal(under.y, (ledge.y + ledge.h) * S + BERRY_HEIGHT);
});

test("an empty-handed Worker picks a loose berry up; a Warrior or a carrying Worker on the ground kicks a resting one straight up at 5 u/s", () => {
  const state = bare();
  loose(state, OPEN, FLOOR).resting = true;
  const worker = stand(state, 2, OPEN + 2, FLOOR);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "berryPickup", slot: 2, pile: -1 }]);
  assert.equal(worker.carrying, true);
  assert.equal(state.loose.length, 0);

  const berry = loose(state, OPEN, FLOOR);
  berry.resting = true;
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "berryKick", slot: 2 }]);
  assert.equal(KICK_LIFT, Math.round((5 * UNIT) / TICK_HZ));
  assert.deepEqual([berry.vx, berry.vy], [0, -KICK_LIFT]);
  assert.equal(berry.resting, false);
  assert.equal(berry.wait, KICK_WAIT);
  assert.equal(berry.by, 2);
  // It cannot be kicked again until the wait has run out.
  assert.deepEqual(run(state, 3), []);
  assert.ok(berry.y < FLOOR * S);

  const other = bare();
  const second = loose(other, OPEN, FLOOR);
  second.resting = true;
  stand(other, 1, OPEN - 3, FLOOR);
  stepRound(other, []);
  assert.deepEqual(other.events, [{ type: "berryKick", slot: 1 }]);
  // A flyer passing over a resting berry leaves it alone.
  const air = bare();
  const third = loose(air, OPEN, FLOOR);
  third.resting = true;
  put(air, 3, OPEN, FLOOR - 2, { kind: "warrior" });
  stepBerries(air);
  assert.deepEqual(air.events, []);
  assert.equal(third.resting, true);
});

test("a flying berry bounces off a body that cannot take it, along the axis it came in on, and twice as hard off the snail", () => {
  const state = bare();
  const warrior = stand(state, 2, OPEN, FLOOR, { kind: "warrior" });
  const side = loose(state, OPEN + 5, FLOOR - 6);
  side.vx = -600;
  stepBerries(state);
  assert.ok(side.vx > 500, `thrown back, ${side.vx}`);
  // Already leaving: untouched.
  const leaving = side.vx;
  side.x = (OPEN + 5) * S;
  side.vy = 0;
  stepBerries(state);
  assert.ok(Math.abs(side.vx - leaving) < 30);
  // From above it bounces up, and takes the body's own speed along.
  state.loose.length = 0;
  warrior.vy = -200;
  const top = loose(state, OPEN, FLOOR - 15);
  top.vy = 300;
  stepBerries(state);
  assert.ok(top.vy < -600, `bounced up, ${top.vy}`);
  // Leaving upward already: untouched.
  const rising = top.vy;
  top.y = (FLOOR - 15) * S;
  stepBerries(state);
  assert.ok(top.vy >= rising);

  const snail = bare();
  const track = MAP.snail.y;
  snail.snail.x = OPEN * S;
  const thrown = loose(snail, OPEN + 14, track - 8);
  thrown.vx = -400;
  stepBerries(snail);
  assert.ok(thrown.vx > 700, `snail threw it back, ${thrown.vx}`);
  const dropped = loose(snail, OPEN, track - 16);
  dropped.vy = 300;
  stepBerries(snail);
  assert.ok(dropped.vy < -500, `snail threw it up, ${dropped.vy}`);
});

test("a kicked berry that reaches an empty hole scores for that hive, whoever kicked it", () => {
  const state = bare();
  const target = MAP.holes[0][4];
  assert.ok(target);
  loose(state, target.x, target.y + 2, 3);
  stepRound(state, []);
  assert.deepEqual(ofType(state.events, "berryKickIn"), [
    { type: "berryKickIn", slot: 3, team: 0, hole: 4 },
  ]);
  assert.equal(state.holes[0]?.[4], true);
  assert.equal(state.loose.length, 0);
});

test("a berry flying fast past a hole is still caught, and a Worker sitting in a hole keeps a loose berry out", () => {
  const state = bare();
  const target = arenaOf(1).holes[1][2];
  assert.ok(target);
  const fast = loose(state, 0, 0, 2);
  fast.x = target.x - 3 * S;
  fast.y = target.y + Math.trunc(BERRY_HEIGHT / 2);
  fast.vx = 6 * S;
  stepBerries(state);
  assert.deepEqual(state.events, [
    { type: "berryKickIn", slot: 2, team: 1, hole: 2 },
  ]);
  const taken = bare();
  atHole(taken, 3, 1, 2);
  stepBerries(taken);
  assert.equal(unitOf(taken, 3).deposit, 2);
  const blocked = loose(taken, 0, 0);
  blocked.x = target.x;
  blocked.y = target.y + Math.trunc(BERRY_HEIGHT / 2) - 200;
  stepBerries(taken);
  assert.deepEqual(ofType(taken.events, "berryKickIn"), []);
});

test("a rider or a dead unit does not touch loose berries", () => {
  const state = bare();
  loose(state, OPEN, FLOOR).resting = true;
  put(state, 2, OPEN, FLOOR, { riding: true });
  put(state, 4, OPEN, FLOOR, { dead: true, respawn: 1000 });
  state.step = 1;
  stepBerries(state);
  assert.deepEqual(state.events, []);
  assert.equal(state.loose.length, 1);
});
