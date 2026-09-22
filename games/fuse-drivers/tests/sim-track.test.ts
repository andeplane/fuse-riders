import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTrack, surfaceAt } from "../src/game/sim/track.js";

const json = () =>
  JSON.parse(readFileSync("games/fuse-drivers/tracks/refinery.tmj", "utf8"));

test("parses the committed refinery track", () => {
  const t = parseTrack(json(), "refinery");
  assert.equal(t.cols, 32);
  assert.equal(t.rows, 16);
  assert.ok(t.walls.length > 50);
  assert.ok(t.checkpoints.length >= 8);
  assert.equal(t.spawns.length, 5);
  assert.ok(t.waypoints.length > 50);
  assert.equal(t.items.length, 3);
  assert.equal(surfaceAt(t, 580, 437), "boost");
  assert.equal(surfaceAt(t, 700, 437), "dirt");
  assert.equal(surfaceAt(t, -1, 0), "dirt");
  assert.equal(surfaceAt(t, 5, 5), "dirt");
});

test("rejects a map missing a required layer, naming it", () => {
  const j = json();
  j.layers = j.layers.filter((l: { name: string }) => l.name !== "checkpoints");
  assert.throws(() => parseTrack(j), /objectgroup layer "checkpoints"/);
});

test("rejects an external tileset and an unknown surface", () => {
  const j = json();
  j.tilesets[0].source = "surfaces.tsx";
  assert.throws(() => parseTrack(j), /embedded/);
  const k = json();
  k.tilesets[0].tiles[0].properties[0].value = "lava";
  assert.throws(() => parseTrack(k), /unknown surface "lava"/);
});

test("rejects non-finite coordinates", () => {
  const j = json();
  j.layers.find((l: { name: string }) => l.name === "spawns").objects[0].x =
    "nope";
  assert.throws(() => parseTrack(j), /spawn x/);
});
