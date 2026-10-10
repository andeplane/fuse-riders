import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/engine/grid.js";
import {
  TEMPLE_LANDMARKS,
  TEMPLE_MAP,
  buildTempleGrid,
  skyZones,
  spawnAnchors,
  spawnOrder,
  type Point,
} from "../src/engine/temple-map.js";

const grid = buildTempleGrid();
/** The gunship collision radius the map is laid out for, and the lattice its centre is tested on. */
const SHIP = 26;
const STEP = 16;
const clear = (p: Point, r: number): boolean =>
  !G.circleOverlapsSolid(grid, p.x, p.y, r);
const dist = (a: Point, b: Point): number =>
  Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

// Where a gunship's centre fits on a 16 px lattice (`free`), flood-filled from the first spawn anchor (`reached`).
const cols = grid.width / STEP;
const free = new Uint8Array(cols * (grid.height / STEP)).map((_, i) => {
  const p = { x: (i % cols) * STEP + 8, y: Math.floor(i / cols) * STEP + 8 };
  const inside = Math.min(p.x, p.y, 4800 - p.x, 2700 - p.y) >= SHIP;
  return inside && clear(p, SHIP) ? 1 : 0;
});
const cellOf = (p: Point): number =>
  Math.floor(p.y / STEP) * cols + Math.floor(p.x / STEP);
const reached = new Uint8Array(free.length);
const queue = [cellOf(spawnAnchors[0] ?? { x: 0, y: 0 })];
for (let i = queue.pop(); i !== undefined; i = queue.pop()) {
  reached[i] = 1;
  const left = i % cols > 0 ? i - 1 : -1;
  const right = i % cols < cols - 1 ? i + 1 : -1;
  for (const j of [left, right, i - cols, i + cols])
    if (free[j] === 1 && reached[j] === 0) queue.push(j);
}

test("the temple is 4800 × 2700 in 4 px cells, built the same every time", () => {
  const { width, height, cell, cols, rows, version } = grid;
  assert.deepEqual(
    [width, height, cell, cols, rows, version],
    [4800, 2700, 4, 1200, 675, 0],
  );
  assert.equal(G.gridHash(buildTempleGrid()), G.gridHash(grid));
  const data = G.encodeGrid(grid);
  assert.ok(data.length < 20_000, "a few thousand runs");
  assert.deepEqual(G.decodeGrid(data, TEMPLE_MAP), grid);
});

test("the temple leaves at least 300 px of open sky along every edge", () => {
  const m = 300 / grid.cell;
  for (let row = 0; row < grid.rows; row++)
    for (let col = 0; col < grid.cols; col++) {
      const edge = Math.min(col, row, grid.cols - 1 - col, grid.rows - 1 - row);
      if (edge < m) assert.ok(!G.cellSolid(grid, col, row), `${col},${row}`);
    }
});

test("rock is a sensible share of the map and hard rock a small minority of it", () => {
  const { solid, hard } = G.countCells(grid);
  const share = solid / (grid.cols * grid.rows);
  assert.ok(share > 0.12 && share < 0.35, `rock ${share}`);
  assert.ok(hard > 0, "the temple keeps a skeleton");
  assert.ok(hard / solid < 0.1, `hard ${hard / solid} of the rock`);
});

test("every spawn anchor floats in open air, 60 px from rock, all round the map", () => {
  assert.ok(spawnAnchors.length >= 12);
  for (const [i, a] of spawnAnchors.entries()) {
    assert.ok(clear(a, 60), `anchor ${i} is within 60 px of rock`);
    const edge = Math.min(a.x, a.y, 4800 - a.x, 2700 - a.y);
    assert.ok(edge >= 100, `anchor ${i} hugs the edge`);
  }
  for (const third of [0, 1, 2]) {
    assert.ok(spawnAnchors.some((a) => Math.floor(a.x / 1600) === third));
    assert.ok(spawnAnchors.some((a) => Math.floor(a.y / 900) === third));
  }
});

test("all open air is one region a gunship can fly through, anchor to anchor", () => {
  const sealed = [...free.keys()].filter((i) => free[i] && !reached[i]);
  const where = sealed.map((i) =>
    [i % cols, (i / cols) | 0].map((v) => v * STEP),
  );
  assert.deepEqual(where.slice(0, 10), [], `${sealed.length} sealed places`);
  assert.ok(free.some((f) => f === 1));
  for (const [i, a] of spawnAnchors.entries())
    assert.equal(reached[cellOf(a)], 1, `anchor ${i}`);
});

test("the shrine tunnel and the cave are enclosed by rock yet reachable", () => {
  const { tunnel, cave, caveMouth, caveExit, leftBay, rightBay } =
    TEMPLE_LANDMARKS;
  for (const [name, p] of Object.entries(TEMPLE_LANDMARKS))
    assert.equal(reached[cellOf(p)], 1, `${name} is reachable`);
  // A gunship flies straight through the tunnel, with room to spare.
  for (let x = 1790; x <= 3010; x += 8)
    assert.ok(clear({ x, y: tunnel.y }, SHIP + 8), `tunnel at x ${x}`);
  for (const [p, dy] of [
    [tunnel, 120],
    [cave, 220],
  ] as const) {
    assert.ok(G.solidAt(grid, p.x, p.y - dy), "rock above");
    assert.ok(G.solidAt(grid, p.x, p.y + dy), "rock below");
  }
  assert.ok(clear(cave, SHIP * 3), "the cave is roomy");
  for (const p of [caveMouth, caveExit, leftBay, rightBay])
    assert.ok(clear(p, SHIP + 8));
});

test("sky zones are open air inside the world, 30 px clear of rock", () => {
  assert.ok(skyZones.length >= 5);
  for (const [i, z] of skyZones.entries()) {
    assert.ok(z.x0 >= 0 && z.y0 >= 0 && z.x1 <= 4800 && z.y1 <= 2700);
    assert.ok(z.x0 < z.x1 && z.y0 < z.y1, `zone ${i}`);
    for (let y = z.y0 - 30; y <= z.y1 + 30; y += grid.cell)
      for (let x = z.x0 - 30; x <= z.x1 + 30; x += grid.cell)
        assert.ok(!G.solidAt(grid, x, y), `zone ${i} meets rock at ${x},${y}`);
  }
});

test("spawnOrder deals a spread, seeded set of distinct anchors to 2–6 seats", () => {
  for (let count = 2; count <= 6; count++) {
    const sets = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const spawns = spawnOrder(count, seed);
      assert.deepEqual(spawnOrder(count, seed), spawns, "deterministic");
      const ids = spawns.map((s) => spawnAnchors.indexOf(s));
      assert.equal(new Set(ids).size, count, "distinct anchors");
      assert.ok(ids.every((i) => i >= 0));
      for (const a of spawns)
        for (const b of spawns)
          if (a !== b) assert.ok(dist(a, b) >= 900, `${count}: ${ids}`);
      sets.add(ids.sort((a, b) => a - b).join());
    }
    assert.ok(sets.size >= 3, `${count} players: only ${sets.size} sets`);
  }
  // Seats are dealt in a seeded order, so seat 0 is not always the same corner.
  const seat0 = Array.from({ length: 50 }, (_, s) => spawnOrder(2, s)[0]);
  assert.ok(new Set(seat0).size >= 4);
  for (const bad of [0, 1, 7, 2.5, NaN])
    assert.throws(() => spawnOrder(bad, 1), RangeError, String(bad));
});
