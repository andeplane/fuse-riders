import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiCommands } from "../src/engine/ai.js";
import {
  createMatch,
  loadMap,
  step,
  encodeState,
  decodeState,
  hashState,
} from "../src/engine/index.js";

const map = loadMap(
  JSON.parse(
    readFileSync(new URL("../maps/skirmish-24.json", import.meta.url), "utf8"),
  ),
);
test("skirmish arena is larger, connected and rotationally symmetric", () => {
  assert.equal(map.cells.length, 480);
  for (let cell = 0; cell < map.cells.length; cell++)
    assert.deepEqual(map.cells[cell], map.cells[map.cells.length - 1 - cell]);
  assert.equal(
    map.spawns[0]!.cellIndex + map.spawns[1]!.cellIndex,
    map.cells.length - 1,
  );
});
test("opposite starts make rotated opening decisions without an absolute-cell preference", () => {
  let left = createMatch(map, {}, [
    { id: "ai", slot: 0 },
    { id: "idle", slot: 1 },
  ]);
  let right = createMatch(map, {}, [
    { id: "ai", slot: 1 },
    { id: "idle", slot: 0 },
  ]);
  for (let tick = 0; tick < 1200; tick++) {
    const a = aiCommands(left, "ai");
    const b = aiCommands(right, "ai");
    const rotated = a.map((command) => ({
      ...command,
      action:
        "cell" in command.action
          ? {
              ...command.action,
              cell: map.cells.length - 1 - command.action.cell,
            }
          : command.action,
    }));
    assert.deepEqual(b, rotated, `opening decision at tick ${tick}`);
    left = step(left, a);
    right = step(right, b);
  }
  assert.deepEqual(
    left.players.find((p) => p.id === "ai")!.statistics,
    right.players.find((p) => p.id === "ai")!.statistics,
  );
});
test("AI grows and researches using valid ordinary commands and replays from checkpoint", () => {
  let world = createMatch(map, {}, [
    { id: "human", slot: 0 },
    { id: "ai", slot: 1 },
  ]);
  const before = encodeState(world);
  aiCommands(world, "ai");
  assert.equal(encodeState(world), before, "policy must not mutate input");
  let restored = decodeState(before);
  for (let tick = 0; tick < 1000; tick++) {
    world = step(world, aiCommands(world, "ai"));
    restored = step(restored, aiCommands(restored, "ai"));
    assert.equal(
      world.outcomes.some((e) => e.type === "rejected"),
      false,
    );
    if (tick % 100 === 0) restored = decodeState(encodeState(restored));
  }
  assert.equal(hashState(world), hashState(restored));
  const ai = world.players.find((p) => p.id === "ai")!;
  assert.ok(ai.statistics.built >= 3);
  assert.ok(ai.research.length > 0 || ai.researchJob);
  assert.ok(
    world.particles.some(
      (p) => p.ownerId === "ai" && p.cell !== map.spawns[1]!.cellIndex,
    ),
  );
  assert.equal(
    world.players.find((p) => p.id === "human")!.statistics.built,
    0,
  );
});
