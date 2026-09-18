import assert from "node:assert/strict";
import test from "node:test";
import { PICKUP_TYPES } from "../src/engine/pickup-types.ts";
import { PICKUPS, PICKUP_WEIGHTS } from "../src/engine/pickups.ts";
import {
  beginMatchParticipant,
  recordPickup,
  type MatchStatsState,
} from "../src/engine/match-stats.ts";
import {
  EFFECTS,
  EFFECT_KINDS,
  applyEffect,
  effectDeadlines,
  expireEffects,
  hasDefensiveGrace,
  hasEffect,
  isHazardImmune,
  isInvulnerable,
  speedMultiplier,
} from "../src/engine/effects.ts";
import { addPlayer, classicSettings, createGame } from "../src/engine/game.ts";

test("every pickup type has exactly one PICKUPS row, and the weights are read in PICKUP_TYPES order", () => {
  assert.deepEqual(Object.keys(PICKUPS).sort(), [...PICKUP_TYPES].sort());
  assert.deepEqual(
    PICKUP_WEIGHTS.map((row) => row.type),
    [...PICKUP_TYPES],
  );
  for (const type of PICKUP_TYPES) {
    const row = PICKUPS[type];
    assert.ok(
      Number.isInteger(row.weight) && row.weight >= 0,
      `${type} has a whole, non-negative default weight`,
    );
    assert.equal(typeof row.collect, "function", `${type} does something`);
  }
});

test("recordPickup counts every type once, and its own counter where the stored results have one", () => {
  for (const type of PICKUP_TYPES) {
    const stats: MatchStatsState = new Map();
    beginMatchParticipant(stats, {
      id: "a",
      name: "A",
      slot: 0,
      color: "#fff",
    });
    const before = { ...stats.get("a")! };
    recordPickup(stats, "a", type);
    const after = stats.get("a")!;
    assert.equal(after.pickupsCollected, before.pickupsCollected + 1, type);
    const changed = Object.keys(after).filter(
      (key) =>
        key !== "pickupsCollected" &&
        after[key as keyof typeof after] !== before[key as keyof typeof before],
    );
    const stat = PICKUPS[type].stat;
    assert.deepEqual(changed, stat ? [stat] : [], type);
  }
});

test("every effect kind has a row, is in force until its deadline and not on it", () => {
  assert.deepEqual(Object.keys(EFFECTS).sort(), [...EFFECT_KINDS].sort());
  for (const kind of EFFECT_KINDS) {
    const game = createGame("effects", classicSettings());
    addPlayer(game, { id: "a", name: "A", slot: 0, color: "#fff" });
    const rider = game.players.get("a")!;
    assert.equal(hasEffect(rider, kind, 0), false, `${kind} starts absent`);
    applyEffect(rider, kind, 10, 20);
    assert.equal(hasEffect(rider, kind, 19), true, `${kind} holds at 19`);
    assert.equal(hasEffect(rider, kind, 20), false, `${kind} is spent at 20`);
    expireEffects(rider, 20);
    assert.equal(hasEffect(rider, kind, 20), false, `${kind} stays spent`);
    const rule = EFFECTS[kind];
    // A stacked deadline leaves the rider; a single one is kept as the record of when it ended.
    assert.deepEqual(
      [...effectDeadlines(rider, kind)].filter((until) => until > 0),
      rule.stacking === "stack" ? [] : [20],
      kind,
    );
    assert.equal(isHazardImmune(rider, 20), false, kind);
    assert.equal(speedMultiplier(rider, 20), 1, kind);
  }
});

test("the readers answer from the table's flags", () => {
  for (const kind of EFFECT_KINDS) {
    const game = createGame("flags", classicSettings());
    addPlayer(game, { id: "a", name: "A", slot: 0, color: "#fff" });
    const rider = game.players.get("a")!;
    applyEffect(rider, kind, 10, 20);
    const rule = EFFECTS[kind];
    assert.equal(isHazardImmune(rider, 15), rule.immune === true, kind);
    assert.equal(isInvulnerable(rider, 15), rule.invulnerable === true, kind);
    assert.equal(
      hasDefensiveGrace(rider, 15),
      rule.defensiveGrace === true,
      kind,
    );
    assert.equal(speedMultiplier(rider, 15), rule.speed ?? 1, kind);
  }
});
