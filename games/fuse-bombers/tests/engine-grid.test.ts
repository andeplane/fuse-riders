import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/engine/grid.js";
import { hashSeed, range, type RngHolder } from "../src/engine/rng.js";

const { carveCircle, cellSolid, createGrid, fillRect, segmentHit, solidAt } = G;
type Grid = G.Grid;

/** Splits a flat list of numbers into rows of `width` (test tables). */
const table = (width: number, flat: number[]): number[][] =>
  Array.from({ length: flat.length / width }, (_, i) =>
    flat.slice(i * width, i * width + width),
  );

/** Every cell as a string, `.` air, `#` rock, `H` hard, row by row. */
function cells(grid: Grid): string {
  let out = "";
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++)
      out += G.cellHard(grid, col, row)
        ? "H"
        : ".#"[+cellSolid(grid, col, row)];
    out += "\n";
  }
  return out;
}

/** A 64 × 64-cell (256 px) grid with rock, hard rock and craters in a seeded pattern. */
function sample(seed: number): Grid {
  const rng: RngHolder = { rng: hashSeed(seed) };
  const at = (): number => range(rng, 0, 256);
  const size = (): number => range(rng, 4, 36);
  const grid = createGrid(256, 256, 4);
  for (let i = 0; i < 12; i++) G.fillCircle(grid, at(), at(), size() + 10);
  for (let i = 0; i < 4; i++) {
    const [x, y] = [at() * 0.85, at() * 0.85];
    fillRect(grid, x, y, x + size(), y + size(), "hard");
  }
  for (let i = 0; i < 6; i++) carveCircle(grid, at(), at(), size());
  return grid;
}

test("createGrid sizes the bitsets; solidAt reads a cell, outside or NaN is air", () => {
  const big = createGrid(4800, 2700, 4);
  const { cols, rows, solid, hard, version } = big;
  assert.deepEqual(
    [cols, rows, solid.length, hard.length, version],
    [1200, 675, 25313, 25313, 0],
  );
  const sizes = [0, 8, 4, 10, 8, 4, 8, 8, 0, 8, 8, 1.5, -8, 8, 4, 8, NaN, 4];
  for (const [w = 0, h = 0, c] of table(3, [...sizes, 32768, 32768, 4]))
    assert.throws(() => createGrid(w, h, c), RangeError, `${w}×${h}/${c}`);
  const grid = createGrid(40, 40, 4);
  fillRect(grid, 0, 0, 8, 4); // centres (2, 2) and (6, 2): cells (0, 0), (1, 0)
  const points = [0, 0, 1, 7.99, 3.99, 1, 8, 0, 0, 0, 4, 0, -0.01, 0, 0];
  for (const [x = 0, y = 0, rock] of table(3, [...points, NaN, 1, 0]))
    assert.equal(solidAt(grid, x, y), rock === 1, `${x},${y}`);
  fillRect(grid, 0, 0, 40, 40);
  for (const [x = 0, y = 0] of table(2, [-1, 5, 40, 5, 5, 40, 5, -1e9]))
    assert.equal(solidAt(grid, x, y), false, `${x},${y}`);
});

test("fills paint cells by their centres, later paint wins, air clears both", () => {
  const grid = createGrid(16, 16, 4);
  fillRect(grid, 1, 1, 7, 15); // centres 2 and 6 across, 2..14 down
  assert.equal(cells(grid), "##..\n##..\n##..\n##..\n");
  G.fillCircle(grid, 10, 10, 4.1, "hard"); // centres within 4.1 of (10, 10)
  assert.equal(cells(grid), "##..\n##H.\n#HHH\n##H.\n");
  fillRect(grid, 8, 8, 12, 12, "rock"); // rock over hard removes the hardness
  assert.equal(cells(grid), "##..\n##H.\n#H#H\n##H.\n");
  G.fillPolygon(grid, [0, 0, 16, 0, 0, 16], "air"); // centres with x + y < 16
  assert.equal(cells(grid), "....\n..H.\n.H#H\n##H.\n");
  assert.equal(G.hardAt(grid, 13, 9), true);
  assert.equal(G.hardAt(grid, 9, 9), false);
  assert.equal(grid.version, 0, "authoring fills leave the version alone");
});

test("fillPolygon fills concave shapes by the even-odd rule, either winding", () => {
  const l = [40, 40, 360, 40, 360, 120, 120, 120, 120, 360, 40, 360];
  const grid = createGrid(400, 400, 4);
  G.fillPolygon(grid, l);
  for (const [x = 0, y = 0] of table(2, [50, 50, 350, 110, 110, 350]))
    assert.ok(solidAt(grid, x, y));
  assert.equal(solidAt(grid, 200, 200), false, "the notch of the L is open");
  assert.equal(G.countCells(grid).solid, (320 * 80 + 80 * 240) / 16);
  const reversed = createGrid(400, 400, 4);
  G.fillPolygon(reversed, table(2, l).reverse().flat());
  assert.equal(cells(reversed), cells(grid));
});

test("carveCircle clears soft rock, reports the exact dirty rectangle, bumps the version", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const grid = sample(seed);
    const rng: RngHolder = { rng: hashSeed(seed, 7) };
    const [before, version] = [cells(grid), grid.version];
    const x = range(rng, -20, 276);
    const y = range(rng, -20, 276);
    const r = range(rng, 2, 60);
    const dirty = carveCircle(grid, x, y, r);
    const after = cells(grid);
    let box = null as G.CellRect | null;
    for (let row = 0; row < grid.rows; row++)
      for (let col = 0; col < grid.cols; col++) {
        const [was, now] = [before[row * 65 + col], after[row * 65 + col]];
        const [dx, dy] = [(col + 0.5) * 4 - x, (row + 0.5) * 4 - y];
        const gone = was === "#" && dx * dx + dy * dy <= r * r;
        assert.equal(now, gone ? "." : was, `cell ${col},${row}`);
        if (now === was) continue;
        box = {
          col0: Math.min(box?.col0 ?? col, col),
          row0: Math.min(box?.row0 ?? row, row),
          col1: Math.max(box?.col1 ?? 0, col + 1),
          row1: Math.max(box?.row1 ?? 0, row + 1),
        };
      }
    assert.deepEqual(dirty, box);
    assert.equal(grid.version, version + (box ? 1 : 0));
  }
});

test("carving air, hard rock or nothing changes nothing; huge carves stay inside", () => {
  const grid = createGrid(64, 64, 4);
  assert.equal(carveCircle(grid, 32, 32, 20), null);
  fillRect(grid, 0, 0, 64, 64, "hard");
  for (const [x = 0, r = 0] of table(2, [32, 20, 32, 0, 32, -5, NaN, 5]))
    assert.equal(carveCircle(grid, x, 32, r), null);
  assert.equal(grid.version, 0);
  assert.equal(G.countCells(grid).hard, 256);
  fillRect(grid, 0, 0, 64, 64);
  const all = { col0: 0, row0: 0, col1: 16, row1: 16 };
  assert.deepEqual(carveCircle(grid, 0, 0, 1e6), all);
  assert.equal(G.countCells(grid).solid, 0);
});

function assertHit(
  grid: Grid,
  hit: G.SegmentHit | null,
): asserts hit is G.SegmentHit {
  assert.ok(hit, "the segment must hit");
  assert.ok(cellSolid(grid, hit.col, hit.row), "the reported cell is rock");
  assert.ok(hit.t >= 0 && hit.t <= 1);
}

test("segmentHit never tunnels through a vertical wall one cell thick", () => {
  const grid = createGrid(256, 256, 4);
  fillRect(grid, 128, 0, 132, 256); // column 32
  const rng: RngHolder = { rng: hashSeed(3) };
  for (let i = 0; i < 4000; i++) {
    const [x0, x1] = [range(rng, -40, 127.9), range(rng, 132.1, 300)];
    const [y0, y1] = [range(rng, 0, 256), range(rng, 0, 256)];
    const hit = segmentHit(grid, x0, y0, x1, y1);
    assertHit(grid, hit);
    assert.equal(hit.col, 32);
    assert.ok(Math.abs(hit.x - 128) < 1e-9, "it stops where it enters");
    const back = segmentHit(grid, x1, y1, x0, y0);
    assertHit(grid, back);
    assert.ok(Math.abs(back.x - 132) < 1e-9);
  }
});

test("segmentHit never tunnels through a diagonal wall one cell thick, even at corners", () => {
  for (const flip of [false, true]) {
    const grid = createGrid(256, 256, 4);
    // An 8-connected staircase, cells (i, i) or (i, 63 - i): neighbours touch only at corners.
    for (let i = 0; i < 64; i++) {
      const row = flip ? 63 - i : i;
      fillRect(grid, i * 4, row * 4, i * 4 + 4, row * 4 + 4);
    }
    const side = (x: number, y: number): number =>
      flip ? Math.sign(x + y - 256) : Math.sign(y - x);
    const rng: RngHolder = { rng: hashSeed(flip ? 11 : 12) };
    let crossings = 0;
    for (let i = 0; i < 6000; i++) {
      // Every fourth segment joins lattice points, so it can pass exactly through cell corners.
      const pick = (): number =>
        i % 4 === 0 ? Math.round(range(rng, 0, 64)) * 4 : range(rng, 0, 256);
      const [x0, y0, x1, y1] = [pick(), pick(), pick(), pick()];
      if (side(x0, y0) * side(x1, y1) !== -1) continue;
      if (solidAt(grid, x0, y0) || solidAt(grid, x1, y1)) continue;
      crossings++;
      assertHit(grid, segmentHit(grid, x0, y0, x1, y1));
      assertHit(grid, segmentHit(grid, x1, y1, x0, y0));
    }
    assert.ok(crossings > 1000, `only ${crossings} crossings`);
  }
});

test("segmentHit returns the nearest rock along the segment, or null in the air", () => {
  const grid = createGrid(256, 256, 4);
  fillRect(grid, 40, 0, 48, 256);
  fillRect(grid, 200, 0, 208, 256);
  const hit = (...v: number[]): G.SegmentHit | null =>
    segmentHit(grid, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
  const at = (x: number, y: number, t: number, col: number, row: number) =>
    ({ x, y, t, col, row }) satisfies G.SegmentHit;
  assert.deepEqual(hit(100, 50, 250, 50), at(200, 50, 100 / 150, 50, 12));
  assert.deepEqual(hit(100, 50, 0, 50), at(48, 50, 0.52, 11, 12));
  assert.deepEqual(
    hit(42, 10, 42, 10),
    at(42, 10, 0, 10, 2),
    "a point in rock",
  );
  assert.equal(hit(44, 30, 120, 30)?.t, 0, "starting inside rock");
  assert.equal(hit(-100, 128, 100, 128)?.x, 40, "entering the world");
  assert.equal(hit(400, 60, 0, 60)?.x, 208, "entering from the right");
  const misses = table(4, [
    ...[60, 10, 190, 250], // between the walls
    ...[60, 10, 60, 10], // a point in the air
    ...[-50, -50, 300, -10], // outside the world
    ...[100, 300, 100, -300], // vertical, between the walls
    ...[NaN, 0, 10, 10],
  ]);
  for (const segment of misses)
    assert.equal(hit(...segment), null, `${segment}`);
});

test("circleOverlapsSolid treats cells as squares and touching as clear", () => {
  const grid = createGrid(80, 80, 4);
  fillRect(grid, 40, 40, 44, 44); // one cell, [40, 44)²
  const cases = table(4, [
    ...[50, 42, 5.9, 0, 50, 42, 6, 0, 50, 42, 6.1, 1], // an edge, touching at 6
    ...[48, 48, 5.6, 0, 48, 48, 5.7, 1], // the corner, sqrt(32) away
    ...[42, 42, 0, 1, 30, 42, 0, 0], // points
  ]);
  for (const [x = 0, y = 0, r = 0, hit] of cases)
    assert.equal(
      G.circleOverlapsSolid(grid, x, y, r),
      hit === 1,
      `${x},${y} r${r}`,
    );
  // Against the slow, obvious answer: the nearest point of each rock cell's square.
  for (let seed = 1; seed <= 6; seed++) {
    const g = sample(seed);
    const rng: RngHolder = { rng: hashSeed(seed, 5) };
    for (let i = 0; i < 150; i++) {
      const [x, y] = [range(rng, -30, 290), range(rng, -30, 290)];
      const r = range(rng, 0.5, 40);
      let slow = false;
      for (let row = 0; row < g.rows; row++)
        for (let col = 0; col < g.cols; col++) {
          const nx = Math.min(Math.max(x, col * 4), col * 4 + 4) - x;
          const ny = Math.min(Math.max(y, row * 4), row * 4 + 4) - y;
          if (cellSolid(g, col, row) && nx * nx + ny * ny < r * r) slow = true;
        }
      assert.equal(G.circleOverlapsSolid(g, x, y, r), slow, `${x},${y} r${r}`);
    }
  }
});

test("the codec round-trips grids of every shape, including a partial last word", () => {
  const solid = (paint: G.Paint): Grid => {
    const grid = createGrid(48, 48, 4); // 144 cells: four and a half words
    fillRect(grid, 0, 0, 48, 48, paint);
    return grid;
  };
  const shapes = [solid("air"), solid("rock"), solid("hard"), sample(1)];
  for (const grid of [...shapes, sample(2), sample(3)]) {
    grid.version = 17;
    const data = G.encodeGrid(grid);
    assert.equal(data[0], G.GRID_FORMAT);
    assert.ok(data.every((v) => Number.isSafeInteger(v) && v >= 0));
    const back = G.decodeGrid(data, grid);
    assert.ok(back);
    assert.equal(cells(back), cells(grid));
    assert.deepEqual(back, grid);
  }
  assert.deepEqual(G.encodeGrid(solid("air")).slice(5), [144 * 3]);
  assert.deepEqual(G.encodeGrid(solid("hard")).slice(5), [144 * 3 + 2]);
});

test("decodeGrid refuses malformed data and never returns a partial grid", () => {
  const good = G.encodeGrid(sample(9));
  const [header, runs] = [good.slice(0, 5), good.slice(5)];
  const head = (i: number, v: unknown): unknown[] => {
    const copy: unknown[] = [...good];
    copy[i] = v;
    return copy;
  };
  const run = (...v: unknown[]): unknown[] => [...header, ...v, ...runs];
  const last = runs.at(-1) ?? 3;
  const F = G.GRID_FORMAT;
  const bad: [string, unknown, Grid?][] = [
    ["not an array", { length: 6 }],
    ["a string", good.join()],
    ["header only", header],
    ["another format", head(0, F + 1)],
    ["a size that is not whole cells", [F, 258, 256, 4, 0, 4128 * 3]],
    ["a fractional size", head(1, 256.5)],
    ["a negative size", head(1, -256)],
    ["a cell of zero", head(3, 0)],
    ["an oversize grid", [F, 16384, 16384, 4, 0, G.MAX_GRID_CELLS * 12]],
    ["a size other than expected", good, createGrid(512, 256, 4)],
    ["a negative version", head(4, -1)],
    ["a fractional version", head(4, 0.5)],
    ["a fractional run", run(1.5)],
    ["an empty air run", run(0)],
    ["an empty rock run", run(1)],
    ["a negative run", run(-3)],
    ["a NaN run", run(NaN)],
    ["a string run", run("3")],
    ["a null run", run(null)],
    ["an unsafe integer", run(2 ** 60)],
    ["runs one cell short", [...header, ...runs.slice(0, -1), last - 3]],
    ["runs one cell long", [...header, ...runs.slice(0, -1), last + 3]],
    ["a trailing run", [...good, 3]],
    ["more values than cells", [...header, ...Array<number>(4097).fill(3)]],
  ];
  for (const [why, data, expect] of bad)
    assert.equal(G.decodeGrid(data, expect), undefined, why);
  assert.ok(G.decodeGrid(good, createGrid(256, 256, 4)));
});

test("gridHash follows every cell and the version, and survives structuredClone", () => {
  const grid = sample(4);
  const hash = G.gridHash(grid);
  const clone = structuredClone(grid);
  assert.equal(G.gridHash(clone), hash);
  fillRect(clone, 0, 0, 256, 256, "air");
  assert.equal(G.gridHash(grid), hash, "the clone owns its bitsets");
  // Any single cell, low or high bit of its word alike, changes the hash.
  const seen = new Set([hash]);
  for (const col of [0, 1, 30, 31, 32, 63]) {
    const one = structuredClone(grid);
    const paint = solidAt(grid, col * 4 + 2, 204) ? "air" : "rock";
    fillRect(one, col * 4, 202, col * 4 + 4, 206, paint);
    seen.add(G.gridHash(one));
  }
  assert.equal(seen.size, 7);
  fillRect(clone, 0, 0, 256, 256);
  const filled = G.gridHash(clone);
  assert.ok(carveCircle(clone, 128, 128, 10));
  assert.notEqual(G.gridHash(clone), filled, "a carve changes the hash");
  const carved = G.gridHash(clone);
  clone.version += 1;
  assert.notEqual(G.gridHash(clone), carved, "so does the version");
});
