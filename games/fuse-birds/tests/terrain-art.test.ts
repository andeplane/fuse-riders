import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, getView } from "../src/engine/index.js";
import { carve, generateTerrain } from "../src/engine/terrain.js";
import { terrainKey } from "../src/render/terrain-art.js";

test("terrain texture identity follows content across a rollback branch and its shading neighbors", () => {
  const state = createMatch("art", 123, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  state.terrain = generateTerrain(123, 2, true).terrain;
  const old = getView(state),
    key = terrainKey(old, 2, 5),
    neighbor = terrainKey(old, 3, 5),
    distant = terrainKey(old, 0, 0);
  carve(state.terrain, 380, 660, 18);
  const changed = getView(state);
  assert.notEqual(terrainKey(changed, 2, 5), key);
  assert.notEqual(terrainKey(changed, 3, 5), neighbor);
  assert.equal(terrainKey(changed, 0, 0), distant);
  changed.terrain.revisions.fill(0);
  assert.notEqual(terrainKey(changed, 2, 5), terrainKey(old, 2, 5));
});
