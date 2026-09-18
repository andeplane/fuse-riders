import assert from "node:assert/strict";
import test from "node:test";
import { PICKUP_TYPES, pickupPacing } from "../src/engine/game.ts";
import { PICKUP_WEIGHTS } from "../src/engine/pickup-weights.ts";
import {
  defaultRoomSettings,
  roomPickup,
} from "../src/engine/room-settings.ts";
test("weighted table gives Five one third Triple probability with deterministic intervals", () => {
  assert.deepEqual(
    PICKUP_WEIGHTS.map((row) => row.type),
    PICKUP_TYPES.filter((type) =>
      PICKUP_WEIGHTS.some((row) => row.type === type),
    ),
  );
  const total = PICKUP_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  const counts = new Map<string, number>();
  const defaults = defaultRoomSettings();
  for (let index = 0; index < total; index += 1) {
    const type = roomPickup((index + 0.5) / total, defaults.weights);
    assert.ok(type);
    assert.equal(type, roomPickup((index + 0.5) / total, defaults.weights));
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  for (const row of PICKUP_WEIGHTS)
    assert.equal(counts.get(row.type) ?? 0, row.weight);
  assert.equal(counts.get("triple"), counts.get("five")! * 3);
  assert.equal(roomPickup(0, defaults.weights), "power");
  assert.equal(roomPickup(1 - Number.EPSILON, defaults.weights), "snail");
  assert.equal(roomPickup(0.5, {}), undefined, "nothing weighted, no drop");
});

test("Power is abundant while Star and the other specials stay occasional", () => {
  const total = PICKUP_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  const power = PICKUP_WEIGHTS.find((row) => row.type === "power")!.weight;
  assert.ok(power / total > 0.7 && power / total < 0.8);
  // Star ships enabled like every other special; a host can still switch any of them off in room settings.
  assert.equal(PICKUP_WEIGHTS.find((row) => row.type === "star")?.weight, 160);
  assert.equal(
    PICKUP_WEIGHTS.map((row): string => row.type).includes("target"),
    false,
  );
});

test("default room settings can roll a Star", () => {
  const weights = defaultRoomSettings().weights;
  assert.ok((weights.star ?? 0) > 0, "Star has a default weight");
  const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
  const rolls = Array.from({ length: total }, (_, index) =>
    roomPickup((index + 0.5) / total, weights),
  );
  assert.ok(rolls.includes("star"), "some roll of the defaults lands on Star");
  assert.ok(!rolls.includes("target" as never), "Target Bomb never drops");
});

test("pickup pacing scales with living riders and stays bounded", () => {
  assert.deepEqual(pickupPacing(0), { interval: 40, cap: 0 });
  assert.deepEqual(pickupPacing(1), { interval: 40, cap: 4 });
  assert.deepEqual(pickupPacing(2), { interval: 20, cap: 8 });
  assert.deepEqual(pickupPacing(3), { interval: 13, cap: 12 });
  assert.deepEqual(pickupPacing(4), { interval: 10, cap: 16 });
  assert.deepEqual(pickupPacing(5), { interval: 8, cap: 20 });
});
