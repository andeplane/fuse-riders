import test from "node:test";
import assert from "node:assert/strict";
import {
  BERRY_HEIGHT,
  KICK_SPEED,
  KICK_WAIT,
  MAPS,
  REGROW_STEPS,
  S,
  stepRound,
  type LooseBerry,
  type Round,
  type Unit,
} from "../src/engine/index.js";
import { stepBerries } from "../src/engine/berries.js";
import { bare, ofType, put, run, stand } from "./engine-kit.js";

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

test("a carried berry is banked in an empty hole of the carrier's own hive, never the enemy's or a full hole", () => {
  const state = bare();
  const worker = atHole(state, 2, 0, 0);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "berryDeposit", slot: 2, team: 0, hole: 0 },
  ]);
  assert.equal(worker.carrying, false);
  assert.equal(state.holes[0]?.[0], true);
  // The hole in reach is full now, so the next berry stays in hand.
  atHole(state, 2, 0, 0);
  stepRound(state, []);
  assert.deepEqual(state.events, []);
  assert.equal(worker.carrying, true);
  // An enemy carrier in this hive banks nothing.
  const enemy = atHole(state, 3, 0, 3);
  stepRound(state, []);
  assert.deepEqual(state.events, []);
  assert.equal(enemy.carrying, true);
});

test("filling every hole of a hive is an economy victory", () => {
  const state = bare();
  const holes = state.holes[1];
  assert.ok(holes);
  holes.fill(true);
  holes[3] = false;
  atHole(state, 5, 1, 3);
  stepRound(state, []);
  assert.deepEqual(state.winner, { team: 1, kind: "economy" });
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["berryDeposit", "victory"],
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

test("an empty-handed Worker picks a loose berry up; a Warrior or a carrying Worker kicks it", () => {
  const state = bare();
  loose(state, OPEN, FLOOR).resting = true;
  const worker = stand(state, 2, OPEN + 2, FLOOR);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "berryPickup", slot: 2, pile: -1 }]);
  assert.equal(worker.carrying, true);
  assert.equal(state.loose.length, 0);

  const berry = loose(state, OPEN, FLOOR);
  berry.resting = true;
  worker.facing = -1;
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "berryKick", slot: 2 }]);
  assert.equal(berry.vx, -KICK_SPEED);
  assert.ok(berry.vy < 0);
  assert.equal(berry.resting, false);
  assert.equal(berry.wait, KICK_WAIT);
  assert.equal(berry.by, 2);
  // It cannot be kicked again until the wait has run out.
  const events = run(state, 3);
  assert.deepEqual(events, []);

  const other = bare();
  const second = loose(other, OPEN, FLOOR);
  second.resting = true;
  stand(other, 1, OPEN - 3, FLOOR);
  stepRound(other, []);
  assert.deepEqual(other.events, [{ type: "berryKick", slot: 1 }]);
  assert.equal(second.vx, -KICK_SPEED);
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

test("ninety seconds after the piles run dry they are whole again", () => {
  const state = bare();
  state.piles.fill(0);
  const events = run(state, REGROW_STEPS - 1);
  assert.deepEqual(events, []);
  assert.equal(state.dry, REGROW_STEPS - 1);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "berryRegrow" }]);
  assert.deepEqual(
    state.piles,
    MAP.piles.map((pile) => pile.count),
  );
  assert.equal(state.dry, 0);
  // The clock only runs while every pile is empty.
  state.piles.fill(0);
  run(state, 10);
  state.piles[0] = 1;
  stepRound(state, []);
  assert.equal(state.dry, 0);
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
