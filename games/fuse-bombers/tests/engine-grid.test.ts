import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/engine/grid.js";
import {
  hashSeed,
  int,
  random,
  range,
  type RngHolder,
} from "../src/engine/rng.js";

const { carveCircle, cellSolid, createGrid, fillRect, segmentHit, solidAt } = G;
type Grid = G.Grid;

/**
 * World width, height and cell size of the grids the oracle tests run on. 256 / 4 = 64 columns puts every row on a
 * word boundary; the others (50, 37 and 33 columns) start rows in the middle of a word.
 */
const SHAPES = [
  [256, 256, 4],
  [200, 180, 4],
  [185, 145, 5],
  [99, 66, 3],
] as const;
type Shape = readonly [number, number, number];

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

/** A grid with rock, hard rock and craters in a seeded pattern. */
function sample(seed: number, [width, height, cell]: Shape = SHAPES[0]): Grid {
  const rng: RngHolder = { rng: hashSeed(seed) };
  const size = (): number => range(rng, 4, 36);
  const grid = createGrid(width, height, cell);
  for (let i = 0; i < 12; i++)
    G.fillCircle(
      grid,
      range(rng, 0, width),
      range(rng, 0, height),
      size() + 10,
    );
  for (let i = 0; i < 4; i++) {
    const [x, y] = [range(rng, 0, width) * 0.85, range(rng, 0, height) * 0.85];
    fillRect(grid, x, y, x + size(), y + size(), "hard");
  }
  for (let i = 0; i < 6; i++)
    carveCircle(grid, range(rng, 0, width), range(rng, 0, height), size());
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
  // The largest grid fits exactly; one more column does not.
  const largest = createGrid(2048, 2048, 1);
  assert.equal(largest.solid.length, G.MAX_GRID_CELLS / 32);
  assert.throws(() => createGrid(2049, 2048, 1), RangeError);
  assert.throws(() => createGrid(64, 64, 65), RangeError, "cell too big");
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

test("an empty or inverted rectangle paints nothing, and fills far outside the world change nothing", () => {
  const grid = createGrid(48, 48, 4); // 144 cells: the last word is partial
  fillRect(grid, 8, 8, 24, 24);
  const before = cells(grid);
  const rects = [8, 8, 8, 24, 8, 8, 24, 8, 24, 24, 8, 8, 24, 8, 8, 24];
  for (const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] of table(4, rects))
    fillRect(grid, x0, y0, x1, y1, "air");
  fillRect(grid, NaN, 0, 48, 48, "air");
  fillRect(grid, 0, 0, 48, NaN, "air");
  assert.equal(cells(grid), before);
  // Beyond 2^32 cells the word index of a span would wrap round into the grid.
  const far = createGrid(48, 48, 4);
  for (const x of [1e11, -1e11, 3e12, 2 ** 34, 2 ** 34 + 40, -(2 ** 34)]) {
    fillRect(far, x, 0, x + 40, 48);
    G.fillCircle(far, x, 20, 30);
    G.fillPolygon(far, [x, 0, x + 40, 0, x + 40, 48, x, 48]);
  }
  G.fillCircle(far, Infinity, 20, 30);
  G.fillCircle(far, 20, 20, Infinity);
  assert.equal(G.countCells(far).solid, 0, "nothing finite reaches the grid");
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
  for (const shape of SHAPES)
    for (let seed = 1; seed <= 40; seed++) {
      const [width, height, cell] = shape;
      const grid = sample(seed, shape);
      const rng: RngHolder = { rng: hashSeed(seed, 7) };
      const [before, version] = [cells(grid), grid.version];
      const x = range(rng, -20, width + 20);
      const y = range(rng, -20, height + 20);
      const r = range(rng, 2, 60);
      const dirty = carveCircle(grid, x, y, r);
      const after = cells(grid);
      const stride = grid.cols + 1;
      let box = null as G.CellRect | null;
      for (let row = 0; row < grid.rows; row++)
        for (let col = 0; col < grid.cols; col++) {
          const [was, now] = [
            before[row * stride + col],
            after[row * stride + col],
          ];
          const [dx, dy] = [(col + 0.5) * cell - x, (row + 0.5) * cell - y];
          const gone = was === "#" && dx * dx + dy * dy <= r * r;
          assert.equal(now, gone ? "." : was, `cell ${col},${row} of ${shape}`);
          if (now === was) continue;
          box = {
            col0: Math.min(box?.col0 ?? col, col),
            row0: Math.min(box?.row0 ?? row, row),
            col1: Math.max(box?.col1 ?? 0, col + 1),
            row1: Math.max(box?.row1 ?? 0, row + 1),
          };
        }
      assert.deepEqual(dirty, box, `${shape}`);
      assert.equal(grid.version, version + (box ? 1 : 0));
      void height;
    }
});

test("carving air, hard rock or nothing changes nothing; huge carves stay inside", () => {
  const grid = createGrid(64, 64, 4);
  assert.equal(carveCircle(grid, 32, 32, 20), null);
  fillRect(grid, 0, 0, 64, 64, "hard");
  const nothing = [32, 20, 32, 0, 32, -5, NaN, 5, Infinity, 5, 32, NaN];
  for (const [x = 0, r = 0] of table(2, [...nothing, 32, Infinity]))
    assert.equal(carveCircle(grid, x, 32, r), null, `${x} ${r}`);
  assert.equal(grid.version, 0);
  assert.equal(G.countCells(grid).hard, 256);
  fillRect(grid, 0, 0, 64, 64);
  const all = { col0: 0, row0: 0, col1: 16, row1: 16 };
  assert.deepEqual(carveCircle(grid, 0, 0, 1e6), all);
  assert.equal(G.countCells(grid).solid, 0);
  // A carve far outside the world, or beyond the range where r * r overflows, is still exact.
  fillRect(grid, 0, 0, 64, 64);
  for (const x of [1e12, -1e12, 1e300])
    assert.equal(carveCircle(grid, x, 32, 20), null);
  assert.deepEqual(carveCircle(grid, 32, 32, 1e200), all);
});

test("carving cuts rock loose without making it fall, and the version wraps rather than sticking", () => {
  const grid = createGrid(64, 64, 4);
  fillRect(grid, 16, 4, 48, 12); // a bar
  fillRect(grid, 28, 12, 36, 60); // a pillar under it
  assert.ok(carveCircle(grid, 32, 14, 6)); // cut the pillar's top, leaving it hanging from nothing
  assert.ok(solidAt(grid, 20, 8), "the bar stays where it is");
  assert.ok(solidAt(grid, 32, 40), "and so does the severed pillar");
  assert.ok(!solidAt(grid, 32, 14));
  grid.version = G.MAX_VERSION;
  assert.ok(carveCircle(grid, 20, 8, 3));
  assert.equal(grid.version, 0, "past the 32 bits gridHash reads, it wraps");
  assert.ok(carveCircle(grid, 24, 8, 3));
  assert.equal(grid.version, 1);
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
    ...[10, NaN, 10, 10],
    ...[10, 10, NaN, 10],
    ...[10, 10, 10, NaN],
    ...[Infinity, 10, 100, 10],
    ...[10, -Infinity, 100, 10],
    ...[10, 10, Infinity, 10],
    ...[10, 10, 100, Infinity],
    ...[Infinity, 10, Infinity, 20],
    ...[1e308, 10, -1e308, 10], // a difference too big to be a number
  ]);
  for (const segment of misses)
    assert.equal(hit(...segment), null, `${segment}`);
});

test("segmentHit finds rock at a cell corner whichever way the segment crosses it", () => {
  // One rock cell, [20, 24) × [12, 16): its top-left corner is (20, 12), which belongs to it.
  const grid = createGrid(32, 32, 4);
  fillRect(grid, 20, 12, 24, 16);
  assert.ok(solidAt(grid, 20, 12));
  // Heading left and down along the diagonal through the corner, the walk used to step past the rock.
  const corner = (...v: number[]): G.SegmentHit | null =>
    segmentHit(grid, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
  assert.deepEqual(corner(24, 8, 16, 16), {
    x: 20,
    y: 12,
    t: 0.5,
    col: 5,
    row: 3,
  });
  assert.deepEqual(corner(16, 16, 24, 8)?.t, 0.5, "and the other way round");
  assertHit(grid, corner(28, 4, 20, 12)); // ends in the corner cell
  assertHit(grid, corner(20, 12, 28, 4)); // starts in it
  assertHit(grid, corner(8, 24, 20, 12)); // ends in it, heading up and right
  // Property: whenever an end of a segment is in rock, the segment hits. Lattice points make corner passes common.
  const rng: RngHolder = { rng: hashSeed(8) };
  let ends = 0;
  for (let i = 0; i < 20000; i++) {
    const one = createGrid(32, 32, 4);
    const [col, row] = [int(rng, 1, 6), int(rng, 1, 6)];
    fillRect(one, col * 4, row * 4, col * 4 + 4, row * 4 + 4);
    const lattice = (): number => 4 * int(rng, -1, 9);
    const p = i % 2 === 0 ? lattice : () => int(rng, -4, 36);
    const [x0, y0, x1, y1] = [p(), p(), p(), p()];
    if (!solidAt(one, x0, y0) && !solidAt(one, x1, y1)) continue;
    ends++;
    assert.ok(segmentHit(one, x0, y0, x1, y1), `${x0},${y0} ${x1},${y1}`);
    assert.ok(segmentHit(one, x1, y1, x0, y0), `${x1},${y1} ${x0},${y0}`);
  }
  assert.ok(ends > 200, `only ${ends} segments end in rock`);
});

test("segmentHit treats the far edges of the world as air, as solidAt does", () => {
  const grid = createGrid(64, 64, 4);
  fillRect(grid, 0, 0, 64, 64);
  const hit = (...v: number[]): G.SegmentHit | null =>
    segmentHit(grid, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
  const air = table(4, [
    ...[64, 10, 90, 10], // from the edge, heading out
    ...[64, 10, 64, 40], // along the edge
    ...[64, 10, 64, 10], // a point on it
    ...[10, 64, 10, 90],
    ...[10, 64, 40, 64],
    ...[64, 64, 90, 90], // the corner
    ...[64, 10, 80, 30],
    ...[10, 64, 30, 80],
    ...[100, 64, 10, 64 + 1e-9],
    ...[90, 10, 64, 10], // arriving at the edge from outside: only touching it
    ...[10, 90, 10, 64],
    ...[90, 90, 64, 64],
  ]);
  for (const s of air) assert.equal(hit(...s), null, `${s}`);
  // Heading in from the edge, or along a line just inside it, the segment is in the last cell.
  const into = table(4, [64, 10, 40, 10, 10, 64, 10, 40, 64, 64, 40, 40]);
  for (const s of into) {
    const found = hit(...s);
    assertHit(grid, found);
    assert.equal(found.t, 0, `${s}`);
    assert.ok(found.col === 15 || found.row === 15);
  }
  assertHit(grid, hit(63.999, 10, 63.999, 40));
  assertHit(grid, hit(10, 63.999, 40, 63.999));
  // The near edges belong to the world: x = 0 is in column 0.
  assertHit(grid, hit(0, 10, 0, 40));
  assertHit(grid, hit(0, 10, -30, 10));
  for (const [x0 = 0, y0 = 0] of table(2, [64, 10, 10, 64, 100, 64, 64, 100]))
    assert.equal(solidAt(grid, x0, y0), false, "agrees with solidAt");
});

/** Exact fractions `[numerator, denominator]` with a positive denominator, for the integer-coordinate oracle. */
type Fraction = readonly [number, number];
const compare = (a: Fraction, b: Fraction): number => a[0] * b[1] - b[0] * a[1];
interface Contact {
  /** The parameter along the segment at which it is in `col`, `row`. */
  readonly t: number;
  readonly col: number;
  readonly row: number;
}

/**
 * Every cell an integer-coordinate segment touches, by exact integer arithmetic: `owned` are the cells (half-open,
 * as `solidAt` sees them) holding a point of it, `closed` also the cells whose closed square does. Each comes with the
 * parameter where the segment first reaches it. The cells change only where the segment crosses a cell edge, so
 * those parameters (and the cell between two of them) are all there is to look at.
 */
function contacts(
  cell: number,
  [x0, y0, x1, y1]: readonly number[],
): { owned: Contact[]; closed: Contact[] } {
  const [ox, oy] = [x0 ?? 0, y0 ?? 0];
  const [dx, dy] = [(x1 ?? 0) - ox, (y1 ?? 0) - oy];
  const stops: Fraction[] = [
    [0, 1],
    [1, 1],
  ];
  for (const [from, along] of [
    [ox, dx],
    [oy, dy],
  ] as const) {
    if (along === 0) continue;
    const [lo, hi] = [
      Math.min(from, from + along),
      Math.max(from, from + along),
    ];
    for (let line = Math.ceil(lo / cell); line * cell <= hi; line++) {
      const n = line * cell - from;
      stops.push(along > 0 ? [n, along] : [-n, -along]);
    }
  }
  stops.sort(compare);
  const owned: Contact[] = [];
  const closed: Contact[] = [];
  stops.forEach(([n, d], i) => {
    const [px, py] = [ox * d + dx * n, oy * d + dy * n]; // the point, times d
    const t = n / d;
    owned.push({
      t,
      col: Math.floor(px / (cell * d)),
      row: Math.floor(py / (cell * d)),
    });
    // On an edge the point is in the closed squares of the cells on both sides.
    const [dc, dr] = [cell * d, cell * d];
    const cs = px % dc === 0 ? [px / dc - 1, px / dc] : [Math.floor(px / dc)];
    const rs = py % dr === 0 ? [py / dr - 1, py / dr] : [Math.floor(py / dr)];
    for (const col of cs) for (const row of rs) closed.push({ t, col, row });
    const next = stops[i + 1];
    if (next && compare([n, d], next) < 0) {
      // The cell between this stop and the next, which the segment enters at this stop.
      const [nn, nd] = [n * next[1] + next[0] * d, 2 * d * next[1]];
      const between = {
        t,
        col: Math.floor((ox * nd + dx * nn) / (cell * nd)),
        row: Math.floor((oy * nd + dy * nn) / (cell * nd)),
      };
      owned.push(between);
      closed.push(between);
    }
  });
  return { owned, closed };
}

test("segmentHit matches an exact model: it never misses, and touches only rock it reaches", () => {
  const shapes = [
    [9, 7, 4],
    [11, 6, 3],
    [5, 5, 5],
    [33, 3, 4],
    [40, 40, 1],
  ] as const;
  let hits = 0;
  let touchOnly = 0;
  for (const [cols, rows, cell] of shapes) {
    const rng: RngHolder = { rng: hashSeed(cols * 100 + rows) };
    for (let layout = 0; layout < 30; layout++) {
      const density = [0.03, 0.1, 0.3][layout % 3] ?? 0.1;
      const grid = createGrid(cols * cell, rows * cell, cell);
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++)
          if (random(rng) < density)
            fillRect(
              grid,
              col * cell,
              row * cell,
              (col + 1) * cell,
              (row + 1) * cell,
            );
      for (let i = 0; i < 300; i++) {
        // Lattice points, so segments cross cell corners and edges exactly; some start or end outside the world.
        const pick = (extent: number): number => {
          const v = int(rng, -3 * cell, extent * cell + 3 * cell);
          return int(rng, 0, 2) === 0 ? Math.round(v / cell) * cell : v;
        };
        let s = [pick(cols), pick(rows), pick(cols), pick(rows)];
        if (i % 5 === 0) {
          // A diagonal, which passes through corner after corner.
          const k = int(rng, -8, 8) * cell;
          s = [
            s[0] ?? 0,
            s[1] ?? 0,
            (s[0] ?? 0) + k,
            (s[1] ?? 0) + (i % 10 === 0 ? k : -k),
          ];
        }
        const got = segmentHit(
          grid,
          s[0] ?? 0,
          s[1] ?? 0,
          s[2] ?? 0,
          s[3] ?? 0,
        );
        const { owned, closed } = contacts(cell, s);
        const rock = (c: Contact): boolean => cellSolid(grid, c.col, c.row);
        const first = (list: Contact[]): number =>
          Math.min(...list.filter(rock).map((c) => c.t));
        const [inRock, touching] = [first(owned), first(closed)];
        const where = `${cols}×${rows}/${cell}: ${s}`;
        if (inRock < Infinity) {
          assert.ok(got, `misses rock at ${inRock}: ${where}`);
          assert.ok(
            got.t <= inRock + 1e-9,
            `late ${got.t} > ${inRock}: ${where}`,
          );
        }
        if (!got) continue;
        hits++;
        // Whatever it reports is rock the segment touches, no earlier than it first touches any.
        assert.ok(
          got.t >= touching - 1e-9,
          `early ${got.t} < ${touching}: ${where}`,
        );
        if (inRock === Infinity) touchOnly++;
        assertHit(grid, got);
        const [px, py] = [
          (s[0] ?? 0) + ((s[2] ?? 0) - (s[0] ?? 0)) * got.t,
          (s[1] ?? 0) + ((s[3] ?? 0) - (s[1] ?? 0)) * got.t,
        ];
        assert.ok(
          px >= got.col * cell - 1e-9 &&
            px <= (got.col + 1) * cell + 1e-9 &&
            py >= got.row * cell - 1e-9 &&
            py <= (got.row + 1) * cell + 1e-9,
          `the point is not on its cell: ${where}`,
        );
        assert.ok(Math.abs(got.x - px) < 1e-9 && Math.abs(got.y - py) < 1e-9);
      }
    }
  }
  assert.ok(hits > 10000, `only ${hits} hits`);
  assert.ok(touchOnly > 100 && touchOnly < hits / 10, `${touchOnly} touches`);
});

test("segmentHit finds the nearest rock of a random scatter at any angle", () => {
  for (const shape of SHAPES) {
    const [width, height, cell] = shape;
    const rng: RngHolder = { rng: hashSeed(width, height) };
    for (let seed = 1; seed <= 4; seed++) {
      const grid = sample(seed, shape);
      for (let i = 0; i < 300; i++) {
        const s = [
          range(rng, -20, width + 20),
          range(rng, -20, height + 20),
          range(rng, -20, width + 20),
          range(rng, -20, height + 20),
        ] as const;
        const [dx, dy] = [s[2] - s[0], s[3] - s[1]];
        // The slab test of the segment against every rock cell's square.
        let best = Infinity;
        for (let row = 0; row < grid.rows; row++)
          for (let col = 0; col < grid.cols; col++) {
            if (!cellSolid(grid, col, row)) continue;
            const tx = [
              (col * cell - s[0]) / dx,
              ((col + 1) * cell - s[0]) / dx,
            ];
            const ty = [
              (row * cell - s[1]) / dy,
              ((row + 1) * cell - s[1]) / dy,
            ];
            const enter = Math.max(0, Math.min(...tx), Math.min(...ty));
            const leave = Math.min(1, Math.max(...tx), Math.max(...ty));
            if (enter <= leave) best = Math.min(best, enter);
          }
        const got = segmentHit(grid, ...s);
        assert.equal(got === null, best === Infinity, `${shape}: ${s}`);
        if (!got) continue;
        assert.ok(Math.abs(got.t - best) < 1e-9, `${got.t} vs ${best}`);
        assertHit(grid, got);
      }
    }
  }
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
  for (const shape of SHAPES)
    for (let seed = 1; seed <= 6; seed++) {
      const [width, height, cell] = shape;
      const g = sample(seed, shape);
      const rng: RngHolder = { rng: hashSeed(seed, 5) };
      for (let i = 0; i < 150; i++) {
        const [x, y] = [
          range(rng, -30, width + 30),
          range(rng, -30, height + 30),
        ];
        const r = range(rng, 0.5, 40);
        let slow = false;
        for (let row = 0; row < g.rows; row++)
          for (let col = 0; col < g.cols; col++) {
            const nx = Math.min(Math.max(x, col * cell), col * cell + cell) - x;
            const ny = Math.min(Math.max(y, row * cell), row * cell + cell) - y;
            if (cellSolid(g, col, row) && nx * nx + ny * ny < r * r)
              slow = true;
          }
        assert.equal(
          G.circleOverlapsSolid(g, x, y, r),
          slow,
          `${shape}: ${x},${y} r${r}`,
        );
      }
    }
});

test("circleOverlapsSolid is false far from the world, never wrapping round into it", () => {
  const grid = createGrid(64, 64, 4);
  fillRect(grid, 0, 0, 64, 64); // all rock, so any overlap that is claimed is a wrong one
  const far = [
    1e11,
    -1e11,
    3e12,
    2 ** 34,
    2 ** 34 + 20,
    Infinity,
    -Infinity,
    NaN,
    1e300,
  ];
  for (const x of far)
    for (const [y, r] of [
      [32, 20],
      [32, 1e6],
      [0, 5],
      [64, 5],
    ] as const) {
      assert.equal(
        G.circleOverlapsSolid(grid, x, y, r),
        false,
        `${x},${y} ${r}`,
      );
      assert.equal(
        G.circleOverlapsSolid(grid, y, x, r),
        false,
        `${y},${x} ${r}`,
      );
    }
  assert.equal(G.circleOverlapsSolid(grid, 32, 32, Infinity), true);
  assert.equal(
    G.circleOverlapsSolid(grid, 32, 32, NaN),
    true,
    "a point in rock",
  );
  assert.equal(G.circleOverlapsSolid(grid, -5, 32, 5), false, "touching only");
  assert.equal(G.circleOverlapsSolid(grid, -4.9, 32, 5), true);
  assert.equal(G.circleOverlapsSolid(grid, 69, 32, 5), false, "touching only");
  assert.equal(G.circleOverlapsSolid(grid, 68.9, 32, 5), true);
});

test("the codec round-trips grids of every shape, including a partial last word", () => {
  const solid = (paint: G.Paint): Grid => {
    const grid = createGrid(48, 48, 4); // 144 cells: four and a half words
    fillRect(grid, 0, 0, 48, 48, paint);
    return grid;
  };
  const shapes = [solid("air"), solid("rock"), solid("hard"), sample(1)];
  for (const grid of [...shapes, ...SHAPES.map((s) => sample(2, s))]) {
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

test("a single cell anywhere, at every word edge, encodes as maximal runs and decodes exactly", () => {
  for (const state of [1, 2] as const) {
    for (let i = 0; i < 144; i++) {
      const grid = createGrid(48, 48, 4); // 12 columns: rows straddle words
      const [col, row] = [i % 12, Math.floor(i / 12)];
      fillRect(
        grid,
        col * 4,
        row * 4,
        col * 4 + 4,
        row * 4 + 4,
        state === 1 ? "rock" : "hard",
      );
      const data = G.encodeGrid(grid);
      const runs = [i * 3, 3 + state, (143 - i) * 3].filter((v) => v >= 3);
      assert.deepEqual(data.slice(5), runs, `cell ${i}`);
      assert.deepEqual(G.decodeGrid(data), grid, `cell ${i}`);
    }
  }
  // Whole words, single bits and a run of 31, 32 and 33 either side of every word edge.
  for (const [from, to] of table(2, [
    31,
    64,
    32,
    64,
    33,
    64,
    0,
    31,
    0,
    32,
    0,
    33,
    31,
    143,
    32,
    144 - 1,
  ])) {
    const grid = createGrid(48, 48, 4);
    for (let i = from ?? 0; i < (to ?? 0); i++)
      fillRect(
        grid,
        (i % 12) * 4,
        Math.floor(i / 12) * 4,
        (i % 12) * 4 + 4,
        Math.floor(i / 12) * 4 + 4,
        i % 7 === 0 ? "hard" : "rock",
      );
    assert.deepEqual(G.decodeGrid(G.encodeGrid(grid)), grid, `${from}..${to}`);
  }
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
  const bomb = new Array<unknown>(2 ** 31); // a length that is all holes
  bomb.splice(0, 5, ...header);
  const bad: [string, unknown, Grid?][] = [
    ["not an array", { length: 6 }],
    ["a string", good.join()],
    ["a typed array", Uint32Array.from(good)],
    ["null", null],
    ["header only", header],
    ["another format", head(0, F + 1)],
    ["a size that is not whole cells", [F, 258, 256, 4, 0, 4128 * 3]],
    ["a fractional size", head(1, 256.5)],
    ["a negative size", head(1, -256)],
    ["a cell of zero", head(3, 0)],
    ["a NaN size", head(2, NaN)],
    ["an infinite size", head(2, Infinity)],
    ["an oversize grid", [F, 16384, 16384, 4, 0, G.MAX_GRID_CELLS * 12]],
    ["a cell that is oversize", [F, 256, 256, 128, 0, 12]],
    ["a size other than expected", good, createGrid(512, 256, 4)],
    ["a height other than expected", good, createGrid(256, 128, 4)],
    ["a cell other than expected", good, createGrid(256, 256, 8)],
    ["a negative version", head(4, -1)],
    ["a fractional version", head(4, 0.5)],
    ["a version past 32 bits", head(4, G.MAX_VERSION + 1)],
    ["a version that is not a safe integer", head(4, 2 ** 53)],
    ["a string version", head(4, "0")],
    ["a fractional run", run(1.5)],
    ["an empty air run", run(0)],
    ["an empty rock run", run(1)],
    ["an empty hard run", run(2)],
    ["a negative run", run(-3)],
    ["a NaN run", run(NaN)],
    ["an infinite run", run(Infinity)],
    ["a string run", run("3")],
    ["a null run", run(null)],
    ["a hole for a run", run(...new Array<unknown>(1))],
    ["an unsafe integer", run(2 ** 60)],
    ["runs one cell short", [...header, ...runs.slice(0, -1), last - 3]],
    ["runs one cell long", [...header, ...runs.slice(0, -1), last + 3]],
    ["a trailing run", [...good, 3]],
    [
      "two runs in one state",
      [...header, ...runs.slice(0, -1), 3 * 5 + (last % 3), last - 15],
    ],
    ["more values than cells", [...header, ...Array<number>(4097).fill(3)]],
    ["a length that is all holes", bomb],
  ];
  for (const [why, data, expect] of bad)
    assert.equal(G.decodeGrid(data, expect), undefined, why);
  assert.ok(G.decodeGrid(good, createGrid(256, 256, 4)));
  // The edges of what is allowed.
  const edge = G.decodeGrid([
    F,
    2048,
    2048,
    1,
    G.MAX_VERSION,
    G.MAX_GRID_CELLS * 3 + 1,
  ]);
  assert.ok(edge, "the largest grid, the largest version");
  assert.equal(edge.version, G.MAX_VERSION);
  assert.equal(G.countCells(edge).solid, G.MAX_GRID_CELLS);
});

test("decodeGrid accepts exactly what encodeGrid writes, under random damage", () => {
  const rng: RngHolder = { rng: hashSeed(77) };
  const good = G.encodeGrid(sample(5, SHAPES[1]));
  let accepted = 0;
  for (let i = 0; i < 4000; i++) {
    const data: unknown[] = [...good];
    const at = (): number => int(rng, 0, data.length - 1);
    const strange = [
      -1,
      0,
      1,
      2,
      3,
      4,
      0.5,
      NaN,
      Infinity,
      -0,
      2 ** 31,
      2 ** 32,
      2 ** 53,
      "1",
      null,
      undefined,
    ];
    for (let k = int(rng, 1, 3); k > 0; k--)
      switch (int(rng, 0, 6)) {
        case 0:
          data[at()] = strange[int(rng, 0, strange.length - 1)];
          break;
        case 1: // move cells from one run to the next, which keeps the total
          {
            const j = int(rng, 5, data.length - 2);
            const [a, b] = [data[j], data[j + 1]];
            if (typeof a === "number" && typeof b === "number") {
              const shift = 3 * int(rng, -3, 3);
              data[j] = a + shift;
              data[j + 1] = b - shift;
            }
          }
          break;
        case 2:
          data.splice(at(), 1);
          break;
        case 3:
          data.splice(at(), 0, strange[int(rng, 0, strange.length - 1)]);
          break;
        case 4:
          data.length = at();
          break;
        case 5: // swap two neighbouring runs
          {
            const j = int(rng, 5, data.length - 2);
            [data[j], data[j + 1]] = [data[j + 1], data[j]];
          }
          break;
        default:
          data[4] = int(rng, 0, 1e6);
      }
    const grid = G.decodeGrid(data);
    if (!grid) continue;
    accepted++;
    // The encoding is unique, so anything accepted is exactly what encodeGrid would write for the grid it made.
    assert.deepEqual(G.encodeGrid(grid), data);
    assert.equal(grid.solid.length, grid.hard.length);
    for (let w = 0; w < grid.solid.length; w++)
      assert.equal(
        (grid.hard[w] ?? 0) & ~(grid.solid[w] ?? 0),
        0,
        "hard is rock",
      );
    const rest = grid.cols * grid.rows;
    const spare = grid.solid.length * 32 - rest;
    if (spare > 0)
      assert.equal(
        (grid.solid[grid.solid.length - 1] ?? 0) >>> (32 - spare),
        0,
        "no bits past the last cell",
      );
  }
  assert.ok(accepted > 200 && accepted < 3900, `${accepted} of 4000 accepted`);
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

test("gridHash tells every one-cell difference apart, rock from hard rock, and one shape from another", () => {
  const base = createGrid(48, 48, 4); // 144 cells
  const hashes = new Map<number, string>([[G.gridHash(base), "none"]]);
  const add = (grid: Grid, what: string): void => {
    const h = G.gridHash(grid);
    assert.equal(
      hashes.get(h),
      undefined,
      `${what} collides with ${hashes.get(h)}`,
    );
    hashes.set(h, what);
  };
  for (let i = 0; i < 144; i++) {
    const [x, y] = [(i % 12) * 4, Math.floor(i / 12) * 4];
    for (const paint of ["rock", "hard"] as const) {
      const one = createGrid(48, 48, 4);
      fillRect(one, x, y, x + 4, y + 4, paint);
      add(one, `${paint} at ${i}`);
    }
  }
  // The same bits in another shape, and the same cells at another size.
  add(createGrid(24, 96, 4), "24×96");
  add(createGrid(96, 24, 4), "96×24");
  add(createGrid(96, 48, 8), "96×48 / 8");
  const bumped = createGrid(48, 48, 4);
  bumped.version = 1;
  add(bumped, "version 1");
  bumped.version = G.MAX_VERSION;
  add(bumped, "the largest version");
});

test("cells exactly r from the centre are carved and filled, and a rock square exactly r away only touches", () => {
  // Integer centres and radii put cell centres (4k + 2) exactly r away all the time, so ties are decided, not dodged.
  const [width, height] = [28, 20]; // 7 × 5 cells: a row never ends on a word edge
  for (let cx = -2; cx <= 30; cx++)
    for (let cy = -2; cy <= 22; cy++)
      for (let r = 1; r <= 14; r++) {
        const grid = createGrid(width, height, 4);
        fillRect(grid, 0, 0, width, height);
        const filled = createGrid(width, height, 4);
        G.fillCircle(filled, cx, cy, r);
        const dirty = carveCircle(grid, cx, cy, r);
        let count = 0;
        for (let row = 0; row < 5; row++)
          for (let col = 0; col < 7; col++) {
            const [dx, dy] = [col * 4 + 2 - cx, row * 4 + 2 - cy];
            const inside = dx * dx + dy * dy <= r * r;
            if (inside) count++;
            const at = `${cx},${cy} r${r} cell ${col},${row}`;
            assert.equal(cellSolid(grid, col, row), !inside, at);
            assert.equal(cellSolid(filled, col, row), inside, at);
          }
        assert.equal(dirty === null, count === 0, `${cx},${cy} r${r}`);
      }
  for (let x = -6; x <= 34; x++)
    for (let r = 1; r <= 12; r++) {
      const grid = createGrid(28, 20, 4);
      fillRect(grid, 8, 8, 12, 12); // one rock cell, [8, 12)²
      for (const y of [4, 8, 10, 14, 18]) {
        const nx = Math.min(Math.max(x, 8), 12) - x;
        const ny = Math.min(Math.max(y, 8), 12) - y;
        assert.equal(
          G.circleOverlapsSolid(grid, x, y, r),
          nx * nx + ny * ny < r * r,
          `${x},${y} r${r}`,
        );
      }
    }
});

test("a rectangle paints the cells whose centres are in [x0, x1) × [y0, y1), the low edge included", () => {
  const grid = createGrid(16, 16, 4);
  fillRect(grid, 2, 2, 6, 6); // centre 2 is on the low edge, in; centre 6 on the high edge, out
  assert.equal(cells(grid), "#...\n....\n....\n....\n");
  fillRect(grid, 2.01, 2.01, 6.01, 6.01, "hard"); // now 2 is below the edge and 6 inside it
  assert.equal(cells(grid), "#...\n.H..\n....\n....\n");
  const full = createGrid(16, 16, 4);
  fillRect(full, 0, 0, 16, 16);
  fillRect(full, 6, 6, 14, 14, "air"); // centres 6 and 10 are in, 2 and 14 are not
  assert.equal(cells(full), "####\n#..#\n#..#\n####\n");
});

test("a segment entering from the left whose entry point rounds just below zero still starts in column 0", () => {
  // The entry x comes out as -1.4e-14, so its cell is -1, which is the last cell of the row above in the bitset.
  const [x0, y0, x1, y1] = [
    -99.98979865713045, 4.236249148845673, 262.9467383492738,
    162.53543835878372,
  ];
  const grid = createGrid(256, 256, 4);
  fillRect(grid, 252, 40, 256, 44); // cell (63, 10), the cell before the entry's row; the segment never goes near it
  assert.equal(segmentHit(grid, x0, y0, x1, y1), null);
  fillRect(grid, 0, 40, 4, 56); // a wall the segment does reach, at its entry
  const hit = segmentHit(grid, x0, y0, x1, y1);
  assertHit(grid, hit);
  assert.equal(hit.col, 0);
});

test("the codec covers the extremes: a checkerboard of one-cell runs, the biggest cell, neighbouring equal runs", () => {
  const board = createGrid(16, 16, 4); // 16 cells, every other one rock or hard
  for (let i = 0; i < 16; i += 2) {
    const [x, y] = [(i % 4) * 4, Math.floor(i / 4) * 4];
    fillRect(board, x, y, x + 4, y + 4, i % 4 === 0 ? "rock" : "hard");
  }
  const data = G.encodeGrid(board);
  assert.equal(data.length - 5, 16, "as many runs as cells");
  assert.deepEqual(G.decodeGrid(data), board);
  assert.equal(G.decodeGrid([...data, 3]), undefined, "a run too many");
  // Two neighbouring runs in one state hold the same cells, but are not what encodeGrid writes.
  const F = G.GRID_FORMAT;
  assert.ok(G.decodeGrid([F, 64, 64, 4, 0, 3 * 100 + 1, 3 * 156]), "rock, air");
  assert.ok(
    G.decodeGrid([F, 64, 64, 4, 0, 3 * 100 + 2, 3 * 156 + 1]),
    "hard, rock",
  );
  for (const state of [0, 1, 2])
    assert.equal(
      G.decodeGrid([F, 64, 64, 4, 0, 3 * 100 + state, 3 * 156 + state]),
      undefined,
      `two runs in state ${state}`,
    );
  // The biggest cell is 64 px; 65 is refused though 130 is a whole number of them.
  assert.ok(createGrid(128, 64, 64));
  assert.throws(() => createGrid(130, 130, 65), RangeError);
  assert.equal(G.decodeGrid([F, 130, 130, 65, 0, 12]), undefined);
  assert.ok(G.decodeGrid([F, 128, 64, 64, 0, 6]), "two cells of air");
  assert.equal(G.decodeGrid([F, 128, 64, 64, 0, 3]), undefined, "one short");
});

test("countCells matches counting the cells one by one, and a carve of Infinity or NaN does nothing", () => {
  for (const shape of SHAPES)
    for (let seed = 1; seed <= 3; seed++) {
      const grid = sample(seed, shape);
      let [solid, hard] = [0, 0];
      for (let row = 0; row < grid.rows; row++)
        for (let col = 0; col < grid.cols; col++) {
          if (cellSolid(grid, col, row)) solid++;
          if (G.cellHard(grid, col, row)) hard++;
        }
      assert.deepEqual(G.countCells(grid), { solid, hard }, `${shape}`);
    }
  const soft = createGrid(64, 64, 4);
  fillRect(soft, 0, 0, 64, 64);
  const before = G.gridHash(soft);
  for (const r of [Infinity, NaN])
    assert.equal(carveCircle(soft, 32, 32, r), null, `r ${r}`);
  assert.equal(G.gridHash(soft), before);
});

test("gridHash differs in its low and its high bits alike when a single cell differs", () => {
  // A hash that only mixes upwards would show a change in a word's top cell only in its top bits.
  const grid = createGrid(256, 256, 4); // 64 columns: row 0 is two words
  const [low, high] = [new Set<number>(), new Set<number>()];
  for (let col = 0; col < 64; col++) {
    const one = structuredClone(grid);
    fillRect(one, col * 4, 0, col * 4 + 4, 4);
    const h = G.gridHash(one);
    low.add(h & 0xffff);
    high.add(h >>> 16);
  }
  assert.equal(low.size, 64, "low 16 bits");
  assert.equal(high.size, 64, "high 16 bits");
});

test("a grid whose last word is partial encodes its uniform state as one run, whatever the length", () => {
  const paints = ["air", "rock", "hard"] as const;
  for (const n of [1, 2, 30, 31, 32, 33, 62, 63, 64, 65, 95, 96, 97]) {
    paints.forEach((paint, state) => {
      const grid = createGrid(4 * n, 4, 4); // n cells in one row
      fillRect(grid, 0, 0, 4 * n, 4, paint);
      assert.deepEqual(
        G.encodeGrid(grid).slice(5),
        [n * 3 + state],
        `${n} ${paint}`,
      );
      assert.deepEqual(G.decodeGrid(G.encodeGrid(grid)), grid, `${n} ${paint}`);
      // One different cell at the very end.
      fillRect(grid, 4 * n - 4, 0, 4 * n, 4, paint === "air" ? "rock" : "air");
      const last = paint === "air" ? 1 : 0;
      const runs = n === 1 ? [3 + last] : [(n - 1) * 3 + state, 3 + last];
      assert.deepEqual(G.encodeGrid(grid).slice(5), runs, `${n} ${paint} end`);
      assert.deepEqual(
        G.decodeGrid(G.encodeGrid(grid)),
        grid,
        `${n} ${paint} end`,
      );
    });
  }
});
