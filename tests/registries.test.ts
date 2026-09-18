import assert from "node:assert/strict";
import test from "node:test";
import { PICKUP_TYPES } from "../src/engine/pickup-types.ts";
import { PICKUPS, PICKUP_WEIGHTS } from "../src/engine/pickups.ts";
import {
  beginMatchParticipant,
  recordPickup,
  type MatchStatsState,
} from "../src/engine/match-stats.ts";

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
