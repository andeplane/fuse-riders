import test from "node:test";
import assert from "node:assert/strict";
import {
  LESSONS,
  LESSON_SLOT,
  MAP_IDS,
  NEUTRAL,
  UNIT,
  arenaOf,
  createRound,
  hashRound,
  standingOn,
  stepRound,
  wrapDelta,
} from "../src/engine/index.js";
import { ofType, unitOf } from "./engine-kit.js";

test("passive bots hold nothing: nobody moves, attacks or wins, and the random stream is untouched", () => {
  const state = createRound({ seed: 5, mapId: 1, passive: true });
  assert.equal(state.passive, true);
  assert.equal(createRound({ seed: 5 }).passive, false);
  const rng = state.rng,
    before = state.units.map((unit) => [unit.x, unit.y, unit.kind]);
  for (let i = 0; i < 1200; i += 1) {
    stepRound(state, []);
    assert.equal(ofType(state.events, "attack").length, 0);
  }
  assert.deepEqual(
    state.units.map((unit) => [unit.x, unit.y, unit.kind]),
    before,
  );
  assert.equal(state.rng, rng);
  assert.equal(state.winner, null);
  // The enemy Queen stays where she hatched, on the ground, for the learner to reach.
  assert.ok(unitOf(state, 1).ground >= 0);
});

test("a killed passive bot respawns and stands still again", () => {
  const state = createRound({ seed: 5, mapId: 1, passive: true });
  const worker = unitOf(state, 3);
  worker.dead = true;
  worker.respawn = 2;
  for (let i = 0; i < 300; i += 1) stepRound(state, []);
  assert.equal(worker.dead, false);
  assert.equal(worker.vx, 0);
  assert.ok(worker.ground >= 0);
});

test("the berry lessons lay one berry two units from seat 2, on its own platform, for it to walk into", () => {
  for (const mapId of [1, 3] as const)
    for (const lesson of ["berries", "warrior"] as const) {
      const arena = arenaOf(mapId),
        spawn = arena.spawns[LESSON_SLOT]!;
      const state = createRound({
        seed: 3,
        mapId,
        lesson,
        passive: true,
        humans: [false, false, true],
      });
      assert.equal(state.loose.length, 1, `map ${mapId}`);
      const berry = state.loose[0]!;
      assert.equal(Math.abs(wrapDelta(berry.x, spawn.x)), 2 * UNIT);
      assert.equal(berry.y, spawn.y);
      assert.equal(
        standingOn(arena, berry.x, berry.y),
        standingOn(arena, spawn.x, spawn.y),
      );
      assert.ok(berry.resting);
      // It lies there until the learner walks into it.
      for (let i = 0; i < 120; i += 1) stepRound(state, []);
      assert.equal(state.loose.length, 1);
      const toward = wrapDelta(berry.x, spawn.x) > 0;
      const walk = [
        NEUTRAL,
        NEUTRAL,
        { ...NEUTRAL, right: toward, left: !toward },
      ];
      let picked = false;
      for (let i = 0; i < 120 && !picked; i += 1) {
        stepRound(state, walk);
        picked = ofType(state.events, "berryPickup").length > 0;
      }
      assert.ok(picked, `map ${mapId}`);
      assert.ok(unitOf(state, LESSON_SLOT).carrying);
      assert.equal(state.loose.length, 0);
    }
});

test("where seat 2's platform is too short, the lesson's berry falls from beside it and comes to rest below", () => {
  const arena = arenaOf(2),
    spawn = arena.spawns[LESSON_SLOT]!;
  const state = createRound({ seed: 3, mapId: 2, lesson: "berries" });
  const berry = state.loose[0]!;
  assert.equal(wrapDelta(berry.x, spawn.x), 2 * UNIT);
  assert.equal(standingOn(arena, berry.x, berry.y), -1);
  assert.equal(berry.resting, false);
  state.passive = true;
  for (let i = 0; i < 240; i += 1) stepRound(state, []);
  assert.equal(state.loose.length, 1);
  assert.ok(berry.resting);
  assert.ok(berry.y > spawn.y);
});

test("the snail lesson starts the snail a quarter of the way from Cyan's goal, facing it", () => {
  for (const mapId of MAP_IDS) {
    const { goals, start } = arenaOf(mapId).snail;
    const state = createRound({ seed: 3, mapId, lesson: "snail" });
    assert.equal(state.snail.x, goals[0] + Math.trunc((start - goals[0]) / 4));
    assert.equal(state.snail.facing, -1);
    assert.ok(state.snail.x > goals[0] + 2 * UNIT, "still a ride away");
  }
});

test("the queen lesson and no lesson start alike; every lesson is listed once and is deterministic", () => {
  assert.deepEqual(LESSONS, ["berries", "warrior", "snail", "queen"]);
  assert.equal(
    hashRound(createRound({ seed: 9, lesson: "queen" })),
    hashRound(createRound({ seed: 9 })),
  );
  for (const lesson of LESSONS)
    assert.equal(
      hashRound(createRound({ seed: 9, lesson, passive: true })),
      hashRound(createRound({ seed: 9, lesson, passive: true })),
    );
});
