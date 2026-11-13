import test from "node:test";
import assert from "node:assert/strict";
import {
  BOUNCE_SPEED,
  BUMP_SPEED,
  HEIGHT_ADVANTAGE,
  QUEEN_EGGS,
  QUEEN_HEIGHT,
  RESPAWN_INVULN,
  RESPAWN_STEPS,
  S,
  WARRIOR_HEIGHT,
  arenaOf,
  isQueenSlot,
  stepRound,
  teamOf,
} from "../src/engine/index.js";
import { duelWinner, resolveCombat } from "../src/engine/combat.js";
import { firstTeam, turnOrder } from "../src/engine/units.js";
import { bare, ofType, put, run, stand, unitOf } from "./engine-kit.js";

const FLOOR = 258;

test("slots: teams alternate, and the first two are the Queens", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(teamOf), [0, 1, 0, 1, 0, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(isQueenSlot), [
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});

test("which team acts first in a contested step is a coin flip from the seed and the step, fair to both teams", () => {
  const state = bare();
  const firsts = [0, 0];
  for (state.step = 0; state.step < 6000; state.step += 1) {
    const first = firstTeam(state);
    assert.ok(first === 0 || first === 1);
    firsts[first] = (firsts[first] ?? 0) + 1;
    assert.deepEqual(
      turnOrder(state),
      first === 0 ? [0, 1, 2, 3, 4, 5] : [1, 0, 3, 2, 5, 4],
    );
  }
  assert.ok(
    Math.abs((firsts[0] ?? 0) - 3000) < 200,
    `team 0 first ${firsts[0]} times of 6000`,
  );
  // The same seed and step always give the same answer; another seed gives another sequence.
  const flips = (seed: number): number[] => {
    const round = bare();
    round.seed = seed;
    return Array.from({ length: 64 }, (_, step) => {
      round.step = step;
      return firstTeam(round);
    });
  };
  assert.deepEqual(flips(7), flips(7));
  assert.notDeepEqual(flips(7), flips(8));
});

test("a Warrior kills an enemy Worker on contact; the Worker respawns at its spawn after the delay, invulnerable", () => {
  const state = bare();
  stand(state, 2, 300, FLOOR, { kind: "warrior" });
  const worker = stand(state, 3, 306, FLOOR);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "kill", victim: 3, killer: 2 }]);
  assert.equal(worker.dead, true);
  assert.equal(worker.respawn, RESPAWN_STEPS);
  const events = run(state, RESPAWN_STEPS - 1);
  assert.deepEqual(events, []);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "respawn", slot: 3 }]);
  const spawn = arenaOf(1).spawns[3];
  assert.ok(spawn);
  assert.equal(worker.dead, false);
  assert.equal(worker.x, spawn.x);
  assert.equal(worker.invuln, RESPAWN_INVULN);
  assert.equal(worker.facing, -1);
});

test("teammates and two Workers pass through each other", () => {
  const state = bare();
  stand(state, 2, 300, FLOOR, { kind: "warrior" });
  stand(state, 4, 304, FLOOR);
  stand(state, 3, 100, FLOOR);
  stand(state, 0, 104, FLOOR, { kind: "worker" });
  assert.deepEqual(run(state, 5), []);
});

test("an invulnerable Worker is not killed: it shoves the military unit away, once per contact", () => {
  const state = bare();
  const warrior = stand(state, 2, 300, FLOOR, { kind: "warrior" });
  const worker = stand(state, 3, 306, FLOOR, { invuln: 50 });
  resolveCombat(state);
  assert.deepEqual(state.events, [{ type: "bump", worker: 3, target: 2 }]);
  assert.equal(worker.dead, false);
  assert.equal(warrior.vx, -BUMP_SPEED);
  assert.ok(warrior.vy < 0);
  resolveCombat(state);
  assert.equal(state.events.length, 1);
  // The other way round: the Worker has the lower slot.
  const mirror = bare();
  const queen = stand(mirror, 1, 300, FLOOR);
  stand(mirror, 2, 306, FLOOR, { invuln: 50 });
  resolveCombat(mirror);
  assert.equal(queen.vx, -BUMP_SPEED);
});

test("between two military units the higher one wins, a dive wins, a hit from behind wins, and face to face bounces", () => {
  const state = bare();
  const a = put(state, 2, 300, 200, { kind: "warrior", facing: 1 });
  const b = put(state, 3, 306, 200, { kind: "warrior", facing: -1 });
  assert.equal(duelWinner(a, b), null);
  a.y = b.y - HEIGHT_ADVANTAGE;
  assert.equal(duelWinner(a, b), a);
  a.y = b.y + HEIGHT_ADVANTAGE;
  assert.equal(duelWinner(a, b), b);
  // One pixel is not a height advantage, unless it is a dive.
  a.y = b.y - S;
  assert.equal(duelWinner(a, b), null);
  a.diving = true;
  assert.equal(duelWinner(a, b), a);
  a.diving = false;
  a.y = b.y + S;
  b.diving = true;
  assert.equal(duelWinner(a, b), b);
  b.diving = false;
  a.y = b.y;
  b.facing = 1;
  assert.equal(duelWinner(a, b), a);
  a.facing = -1;
  assert.equal(duelWinner(a, b), null);
  b.facing = -1;
  assert.equal(duelWinner(a, b), b);
  // Exactly on top of each other there is no behind.
  a.x = b.x;
  assert.equal(duelWinner(a, b), null);
});

test("a face-to-face contact bounces both apart once and kills nobody", () => {
  const state = bare();
  const a = put(state, 2, 300, 200, { kind: "warrior", facing: 1 });
  const b = put(state, 3, 306, 200, { kind: "warrior", facing: -1 });
  resolveCombat(state);
  assert.deepEqual(state.events, [{ type: "bounce", a: 2, b: 3 }]);
  assert.equal(a.vx, -BOUNCE_SPEED);
  assert.equal(b.vx, BOUNCE_SPEED);
  assert.ok(a.vy < 0 && b.vy < 0);
  resolveCombat(state);
  assert.equal(state.events.length, 1);
  // Stacked on the same x they still part, by slot.
  const stacked = bare();
  const low = put(stacked, 2, 300, 200, { kind: "warrior" });
  const high = put(stacked, 3, 300, 200, { kind: "warrior" });
  resolveCombat(stacked);
  assert.equal(low.vx, -BOUNCE_SPEED);
  assert.equal(high.vx, BOUNCE_SPEED);
});

test("an invulnerable loser is bounced instead of killed", () => {
  const state = bare();
  put(state, 2, 300, 190, { kind: "warrior" });
  const low = put(state, 3, 304, 200, { kind: "warrior", invuln: 30 });
  resolveCombat(state);
  assert.equal(low.dead, false);
  assert.deepEqual(state.events, [{ type: "bounce", a: 2, b: 3 }]);
});

test("a killed Warrior comes back as a plain Worker", () => {
  const state = bare();
  put(state, 0, 300, 190);
  const warrior = put(state, 3, 304, 200, { kind: "warrior", speed: true });
  resolveCombat(state);
  assert.deepEqual(state.events, [{ type: "kill", victim: 3, killer: 0 }]);
  assert.equal(warrior.kind, "worker");
  assert.equal(warrior.speed, false);
  // Killing the dead again changes nothing.
  resolveCombat(state);
  assert.equal(state.events.length, 1);
});

test("a Worker killed while carrying drops its berry where it stood", () => {
  const state = bare();
  stand(state, 2, 300, FLOOR, { kind: "warrior" });
  const worker = stand(state, 3, 306, FLOOR, { carrying: true });
  resolveCombat(state);
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["berryDrop", "kill"],
  );
  assert.equal(worker.carrying, false);
  assert.equal(state.loose.length, 1);
  assert.equal(state.loose[0]?.x, worker.x);
  assert.equal(state.loose[0]?.by, 3);
});

test("a Queen's tall body gives her no height: level on the same ledge they bounce, and a Warrior a little above her feet kills her", () => {
  const state = bare();
  const queen = stand(state, 1, 250, FLOOR);
  const warrior = stand(state, 2, 240, FLOOR, { kind: "warrior" });
  queen.facing = -1;
  warrior.facing = 1;
  assert.ok(QUEEN_HEIGHT > 2 * WARRIOR_HEIGHT - 4 * S);
  assert.equal(duelWinner(queen, warrior), null);
  assert.equal(duelWinner(warrior, queen), null);
  // Her head is still far above the Warrior's, and it wins all the same.
  warrior.y -= HEIGHT_ADVANTAGE;
  assert.ok(queen.y - QUEEN_HEIGHT < warrior.y - WARRIOR_HEIGHT);
  assert.equal(duelWinner(queen, warrior), warrior);
  warrior.y += 2 * HEIGHT_ADVANTAGE;
  assert.equal(duelWinner(queen, warrior), queen);
});

test("a Queen has three lives: each death costs an egg and the third is a military victory that freezes the round", () => {
  const state = bare();
  const queen = stand(state, 1, 240, FLOOR);
  for (let life = QUEEN_EGGS; life > 0; life -= 1) {
    queen.invuln = 0;
    queen.x = 240 * S;
    queen.y = FLOOR * S;
    put(state, 2, 240, FLOOR - 8, { kind: "warrior" });
    stepRound(state, []);
    assert.deepEqual(ofType(state.events, "queenKill"), [
      { type: "queenKill", victim: 1, killer: 2, eggsLeft: life - 1 },
    ]);
    assert.equal(state.eggs[1], life - 1);
    if (life > 1) {
      assert.equal(state.winner, null);
      put(state, 2, 20, 40, { kind: "warrior" });
      const events = run(state, RESPAWN_STEPS);
      assert.equal(ofType(events, "respawn").length, 1);
    }
  }
  assert.deepEqual(state.winner, { team: 0, kind: "military" });
  assert.deepEqual(state.events.at(-1), {
    type: "victory",
    team: 0,
    kind: "military",
  });
  const step = state.step;
  stepRound(state, []);
  assert.equal(state.step, step);
  assert.deepEqual(state.events, []);
});
