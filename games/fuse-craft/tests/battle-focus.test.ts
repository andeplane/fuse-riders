import test from "node:test";
import assert from "node:assert/strict";
import { createAttractScene } from "../src/app/attract-scene.js";
import { battleFocusCell } from "../src/render/battle-focus.js";

test("battle camera finds opposing fronts without changing or reordering the world", () => {
  const world = createAttractScene();
  const source = world.structures[0]!;
  world.outcomes = [];
  world.structures = [
    { ...source, cell: 0, ownerId: "a" },
    { ...source, cell: 1, ownerId: "a" },
    { ...source, cell: 9, ownerId: "a", connected: false },
    { ...source, cell: 10, ownerId: "b" },
    { ...source, cell: 11, ownerId: "b" },
  ];
  const before = JSON.stringify(world);
  assert.equal(battleFocusCell(world), 1);
  assert.equal(JSON.stringify(world), before);
  world.structures.reverse();
  assert.equal(battleFocusCell(world), 1);
  world.structures = world.structures.filter((s) => s.ownerId === "a");
  assert.equal(battleFocusCell(world), null);
});

test("battle camera prioritizes an actual hit and breaks equal-hit ties consistently", () => {
  const world = createAttractScene();
  world.outcomes = [
    { tick: world.tick, type: "damage", playerId: "a", cell: 8, amount: 2 },
    { tick: world.tick, type: "damage", playerId: "b", cell: 7, amount: 5 },
    { tick: world.tick, type: "damage", playerId: "a", cell: 6, amount: 5 },
  ];
  assert.equal(battleFocusCell(world), 6);
  world.outcomes.reverse();
  assert.equal(battleFocusCell(world), 6);
});
