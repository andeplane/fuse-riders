import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_MAX,
  buildFlowField,
  flowCacheSize,
  flowFieldBytes,
  loadMap,
  next,
  type GameMap,
} from "../src/engine/index.js";
import { referenceField } from "./fixtures/flow-reference.js";
import { dustBasin, tinyFile } from "./fixtures/maps.js";

/** Every flag's and fort's tile: the goals the fixed cache serves. */
const fixedGoals = (map: GameMap): number[] => [
  ...map.flags.map((f) => f.y * map.width + f.x),
  ...map.sites
    .filter((s) => s.kind === "fort")
    .map((s) => s.y * map.width + s.x),
];

test("lazy flow fields equal the pre-E4 fields on Dust Basin, tile for tile, in any question order", () => {
  const map = dustBasin();
  const tiles = map.width * map.height;
  const sampled = [...fixedGoals(map), -1, tiles, 0];
  for (let tile = 5; tile < tiles; tile += 97) sampled.push(tile);
  let rng = 7;
  for (const goal of sampled) {
    const want = referenceField(map, goal);
    // Asked in a scrambled order first, so the field answers part-grown, then in full.
    const field = buildFlowField(map, goal);
    for (let i = 0; i < 200; i++) {
      const draw = next(rng);
      rng = draw.state;
      const tile = draw.value % tiles;
      assert.equal(field.cost(tile), want.cost[tile], `${goal} from ${tile}`);
      assert.equal(field.next(tile), want.next[tile], `${goal} from ${tile}`);
    }
    assert.deepEqual(field.snapshot(), want, `goal ${goal}`);
  }
});

test("lazy flow fields equal the pre-E4 fields on a map split in two, with blocked and walled-off goals", () => {
  // A rock wall down column 8 cuts fort 1 and flag 1 off from the west; every tile is a goal once.
  const file = tinyFile();
  file.terrain = file.terrain.map((row, y) =>
    y === 0 || y === 9 ? row : `${row.slice(0, 8)}#${row.slice(9)}`,
  );
  const map = loadMap(file);
  for (let goal = -1; goal <= map.width * map.height; goal++) {
    const field = buildFlowField(map, goal);
    const want = referenceField(map, goal);
    // Interleaved questions on a part-grown field, then the whole of it.
    for (const tile of [goal + 13, goal - 29, 3 * goal + 1])
      if (tile >= 0 && tile < map.width * map.height) {
        assert.equal(field.next(tile), want.next[tile], `${goal} from ${tile}`);
        assert.equal(field.cost(tile), want.cost[tile], `${goal} from ${tile}`);
      }
    assert.deepEqual(field.snapshot(), want, `goal ${goal}`);
  }
});

test("the roaming flow cache shrinks on a big map so its memory stays bounded", () => {
  assert.deepEqual(flowCacheSize(dustBasin()), { fixed: 96, roaming: 24 });
  const side = MAP_MAX;
  const open = loadMap({
    name: "Open",
    width: side,
    height: side,
    terrain: Array.from({ length: side }, () => ".".repeat(side)),
    flags: [
      { x: 2, y: 2 },
      { x: side - 3, y: 2 },
    ],
    buildings: [],
    forts: [
      { seat: 0, x: 1, y: 1 },
      { seat: 1, x: side - 2, y: 1 },
    ],
  });
  const { roaming } = flowCacheSize(open);
  assert.equal(roaming, 12);
  assert.ok((roaming * flowFieldBytes(open)) / 2 ** 20 <= 4, "about 4 MB");
});
