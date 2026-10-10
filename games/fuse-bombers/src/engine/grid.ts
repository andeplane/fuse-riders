// Destructible bitmap terrain: the world as a grid of square cells, each open air, rock or indestructible ("hard")
// rock. Two bitsets hold it (bit `row * cols + col`), so a 4800 × 2700 world of 4 px cells is about 100 KB per set,
// survives `structuredClone`, and a point query is a shift and a mask. World units are logical pixels, y down;
// outside the world is open air. Only `+ - * /`, `Math.sqrt`, `floor`, `ceil`, `min`, `max`, `sign`, `imul` and
// `clz32` are used, so results are bit-identical on every engine.

/** What a fill writes into the cells it covers: destructible rock, indestructible rock or open air. */
export type Paint = "rock" | "hard" | "air";

export interface Grid {
  /** World size in logical pixels, a whole number of cells each way. */
  readonly width: number;
  readonly height: number;
  /** Side of one cell in pixels. */
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** Bit `row * cols + col` set: the cell is rock. */
  readonly solid: Uint32Array;
  /** Bit set: the cell is indestructible rock. Always a subset of `solid`. */
  readonly hard: Uint32Array;
  /** Bumped by every carve that changes a cell (authoring fills leave it alone), so a renderer knows to redraw. */
  version: number;
}

/** A rectangle of cells, `col1` and `row1` exclusive. */
export interface CellRect {
  readonly col0: number;
  readonly row0: number;
  readonly col1: number;
  readonly row1: number;
}

/** Where a segment first meets rock: the point, its parameter `t` in [0, 1] along the segment, and the cell. */
export interface SegmentHit {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly col: number;
  readonly row: number;
}

/** Version tag of the `encodeGrid` format. */
export const GRID_FORMAT = 1;
/** Largest grid `createGrid` and `decodeGrid` accept, in cells (512 KB per bitset). */
export const MAX_GRID_CELLS = 1 << 22;
const MAX_CELL = 64;
const HEADER = 5;
const AIR = 0;
const ROCK = 1;
const HARD = 2;
/** The solid and hard word of 32 cells all in one state, by state. */
const SOLID_WORD = [0, 0xffffffff, 0xffffffff];
const HARD_WORD = [0, 0, 0xffffffff];

const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v);

function validSize(width: number, height: number, cell: number): boolean {
  return (
    [width, height, cell].every((v) => isInt(v) && v > 0) &&
    cell <= MAX_CELL &&
    width % cell === 0 &&
    height % cell === 0 &&
    (width / cell) * (height / cell) <= MAX_GRID_CELLS
  );
}

/** An all-air grid. Throws `RangeError` unless the sizes are positive integers, whole cells and not oversize. */
export function createGrid(width: number, height: number, cell = 4): Grid {
  if (!validSize(width, height, cell))
    throw new RangeError(`bad grid size ${width}×${height} / ${cell}`);
  const [cols, rows] = [width / cell, height / cell];
  const words = (cols * rows + 31) >>> 5;
  const [solid, hard] = [new Uint32Array(words), new Uint32Array(words)];
  return { width, height, cell, cols, rows, solid, hard, version: 0 };
}

function bit(bits: Uint32Array, i: number): boolean {
  return (((bits[i >>> 5] ?? 0) >>> (i & 31)) & 1) === 1;
}

/** The bits of word `w` that lie in [start, end), for a word with `w * 32 < end`. */
function spanMask(w: number, start: number, end: number): number {
  const lo = Math.max(start - w * 32, 0);
  const hi = Math.min(end - w * 32, 32);
  return (hi === 32 ? -1 : (1 << hi) - 1) & ~((1 << lo) - 1);
}

function writeSpan(bits: Uint32Array, start: number, end: number, on: boolean) {
  for (let w = start >>> 5; w * 32 < end; w++) {
    const mask = spanMask(w, start, end);
    bits[w] = on ? (bits[w] ?? 0) | mask : (bits[w] ?? 0) & ~mask;
  }
}

function paintSpan(grid: Grid, start: number, end: number, paint: Paint) {
  writeSpan(grid.solid, start, end, paint !== "air");
  writeSpan(grid.hard, start, end, paint === "hard");
}

/** The bit index of cell (`col`, `row`), or -1 outside the grid. */
function cellIndex(grid: Grid, col: number, row: number): number {
  const inside = col >= 0 && col < grid.cols && row >= 0 && row < grid.rows;
  return inside ? row * grid.cols + col : -1;
}

/** Whether cell (`col`, `row`) is rock; cells outside the grid are air. */
export function cellSolid(grid: Grid, col: number, row: number): boolean {
  const i = cellIndex(grid, col, row);
  return i >= 0 && bit(grid.solid, i);
}

/** Whether cell (`col`, `row`) is indestructible rock. */
export function cellHard(grid: Grid, col: number, row: number): boolean {
  const i = cellIndex(grid, col, row);
  return i >= 0 && bit(grid.hard, i);
}

/** Whether the world point (`x`, `y`) is rock. O(1); outside the world (and NaN) is air. */
export function solidAt(grid: Grid, x: number, y: number): boolean {
  return cellSolid(grid, Math.floor(x / grid.cell), Math.floor(y / grid.cell));
}

/** Whether the world point (`x`, `y`) is indestructible rock. */
export function hardAt(grid: Grid, x: number, y: number): boolean {
  return cellHard(grid, Math.floor(x / grid.cell), Math.floor(y / grid.cell));
}

/** The first cell index whose centre is at or past world coordinate `v`. */
const firstCentre = (v: number, cell: number): number =>
  Math.ceil(v / cell - 0.5);

/** Paints every cell whose centre lies in [x0, x1) × [y0, y1). Authoring only: `version` is left alone. */
export function fillRect(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  paint: Paint = "rock",
): void {
  fillPolygon(grid, [x0, y0, x1, y0, x1, y1, x0, y1], paint);
}

/** Calls `span(row, c0, c1)` (c1 exclusive) for each row of cells whose centres lie within `r` of (`cx`, `cy`). */
function discSpans(
  grid: Grid,
  cx: number,
  cy: number,
  r: number,
  span: (row: number, c0: number, c1: number) => void,
): void {
  if (!(r > 0) || ![cx, cy, r].every(Number.isFinite)) return;
  const { cell, cols, rows } = grid;
  const r1 = Math.min(rows - 1, Math.floor((cy + r) / cell - 0.5));
  for (let row = Math.max(0, firstCentre(cy - r, cell)); row <= r1; row++) {
    const dy = (row + 0.5) * cell - cy;
    if (dy * dy > r * r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    const c0 = Math.max(0, firstCentre(cx - half, cell));
    const c1 = Math.min(cols, Math.floor((cx + half) / cell - 0.5) + 1);
    if (c0 < c1) span(row, c0, c1);
  }
}

/** Paints every cell whose centre lies within `r` of (`cx`, `cy`). Authoring only. */
export function fillCircle(
  grid: Grid,
  cx: number,
  cy: number,
  r: number,
  paint: Paint = "rock",
): void {
  discSpans(grid, cx, cy, r, (row, c0, c1) =>
    paintSpan(grid, row * grid.cols + c0, row * grid.cols + c1, paint),
  );
}

/**
 * Paints every cell whose centre lies inside the polygon `points` (flat x, y pairs; even-odd rule, any winding).
 * Authoring only.
 */
export function fillPolygon(
  grid: Grid,
  points: readonly number[],
  paint: Paint = "rock",
): void {
  const { cell, cols, rows } = grid;
  const n = points.length >> 1;
  const ys = points.filter((_, i) => i % 2 === 1);
  const r0 = Math.max(0, firstCentre(Math.min(...ys), cell));
  const r1 = Math.min(rows, firstCentre(Math.max(...ys), cell));
  const xs: number[] = [];
  for (let row = r0; row < r1; row++) {
    const y = (row + 0.5) * cell;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, ay] = [points[2 * i] ?? 0, points[2 * i + 1] ?? 0];
      const [bx, by] = [points[2 * j] ?? 0, points[2 * j + 1] ?? 0];
      if (ay <= y !== by <= y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, firstCentre(xs[k] ?? 0, cell));
      const c1 = Math.min(cols, firstCentre(xs[k + 1] ?? 0, cell));
      paintSpan(grid, row * cols + c0, row * cols + c1, paint);
    }
  }
}

/**
 * Clears the rock (not the hard rock) of every cell whose centre lies within `r` of (`cx`, `cy`). Returns the
 * smallest rectangle holding every cell that changed and bumps `version`, or returns null when nothing changed.
 */
export function carveCircle(
  grid: Grid,
  cx: number,
  cy: number,
  r: number,
): CellRect | null {
  const { solid, hard, cols } = grid;
  let [col0, col1, row0, row1] = [cols, -1, -1, -1];
  discSpans(grid, cx, cy, r, (row, c0, c1) => {
    const base = row * cols;
    let [lo, hi] = [-1, -1];
    for (let w = (base + c0) >>> 5; w * 32 < base + c1; w++) {
      const mask = spanMask(w, base + c0, base + c1);
      const gone = (solid[w] ?? 0) & ~(hard[w] ?? 0) & mask;
      if (gone === 0) continue;
      solid[w] = (solid[w] ?? 0) & ~gone;
      if (lo < 0) lo = w * 32 + 31 - Math.clz32(gone & -gone);
      hi = w * 32 + 31 - Math.clz32(gone);
    }
    if (lo < 0) return;
    if (row0 < 0) row0 = row;
    row1 = row;
    col0 = Math.min(col0, lo - base);
    col1 = Math.max(col1, hi - base);
  });
  if (row0 < 0) return null;
  grid.version += 1;
  return { col0, row0, col1: col1 + 1, row1: row1 + 1 };
}

/**
 * The first rock along the segment from (`x0`, `y0`) to (`x1`, `y1`), or null when it stays in the air. Walks every
 * cell the segment passes through (a grid DDA, stepping one axis at a time), so it never skips a wall one cell thick
 * at any angle. The hit point is where the segment enters that cell (the start itself when it starts in rock).
 */
export function segmentHit(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SegmentHit | null {
  const { cell, cols, rows } = grid;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  // Clip to the world box; outside it is open air.
  if (dx === 0 && (x0 < 0 || x0 > grid.width)) return null;
  if (dy === 0 && (y0 < 0 || y0 > grid.height)) return null;
  const ax = dx === 0 ? -Infinity : -x0 / dx;
  const bx = dx === 0 ? Infinity : (grid.width - x0) / dx;
  const ay = dy === 0 ? -Infinity : -y0 / dy;
  const by = dy === 0 ? Infinity : (grid.height - y0) / dy;
  const tIn = Math.max(0, Math.min(ax, bx), Math.min(ay, by));
  const tOut = Math.min(1, Math.max(ax, bx), Math.max(ay, by));
  if (tIn > tOut) return null;

  let col = Math.min(cols - 1, Math.max(0, Math.floor((x0 + dx * tIn) / cell)));
  let row = Math.min(rows - 1, Math.max(0, Math.floor((y0 + dy * tIn) / cell)));
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let t = tIn;
  for (;;) {
    if (bit(grid.solid, row * cols + col))
      return { x: x0 + dx * t, y: y0 + dy * t, t, col, row };
    // Where the segment crosses the next vertical and horizontal cell edges, from the start each time so rounding
    // never accumulates.
    const tx =
      stepX === 0 ? Infinity : ((col + (stepX + 1) / 2) * cell - x0) / dx;
    const ty =
      stepY === 0 ? Infinity : ((row + (stepY + 1) / 2) * cell - y0) / dy;
    if (Math.min(tx, ty) > tOut) return null;
    if (tx <= ty) col += stepX;
    else row += stepY;
    t = Math.max(t, Math.min(tx, ty));
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  }
}

/** Whether a circle overlaps any rock cell (touching an edge does not count). For gunship collisions. */
export function circleOverlapsSolid(
  grid: Grid,
  x: number,
  y: number,
  r: number,
): boolean {
  if (!(r > 0)) return solidAt(grid, x, y);
  const { cell, cols, rows, solid } = grid;
  const r1 = Math.min(rows - 1, Math.ceil((y + r) / cell) - 1);
  for (let row = Math.max(0, Math.floor((y - r) / cell)); row <= r1; row++) {
    const top = row * cell;
    const dy = y < top ? top - y : y > top + cell ? y - top - cell : 0;
    if (dy >= r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    const c0 = Math.max(0, Math.floor((x - half) / cell));
    const c1 = Math.min(cols, Math.ceil((x + half) / cell));
    const [start, end] = [row * cols + c0, row * cols + c1];
    for (let w = start >>> 5; w * 32 < end; w++)
      if (((solid[w] ?? 0) & spanMask(w, start, end)) !== 0) return true;
  }
  return false;
}

function popcount(word: number): number {
  let v = word - ((word >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** How many cells are rock (hard included) and how many of those are hard. */
export function countCells(grid: Grid): { solid: number; hard: number } {
  let solid = 0;
  let hard = 0;
  for (let w = 0; w < grid.solid.length; w++) {
    solid += popcount(grid.solid[w] ?? 0);
    hard += popcount(grid.hard[w] ?? 0);
  }
  return { solid, hard };
}

/** A 32-bit FNV-style hash of the size, `version` and every cell, for desync checks. */
export function gridHash(grid: Grid): number {
  let h = 0x811c9dc5;
  for (const v of [grid.cols, grid.rows, grid.cell, grid.version]) {
    h = Math.imul(h ^ v, 0x01000193);
    h ^= h >>> 13;
  }
  for (const bits of [grid.solid, grid.hard])
    for (let w = 0; w < bits.length; w++) {
      // The shift folds high bits down, which plain word-wise FNV never does.
      h = Math.imul(h ^ (bits[w] ?? 0), 0x01000193);
      h ^= h >>> 13;
    }
  return h >>> 0;
}

function cellState(grid: Grid, i: number): number {
  return bit(grid.hard, i) ? HARD : bit(grid.solid, i) ? ROCK : AIR;
}

/**
 * Checkpoint form: `[GRID_FORMAT, width, height, cell, version, ...runs]`, each run `length * 3 + state` over the
 * cells in row-major order (state 0 air, 1 rock, 2 hard). A sculpted map is a few thousand runs.
 */
export function encodeGrid(grid: Grid): number[] {
  const out = [GRID_FORMAT, grid.width, grid.height, grid.cell, grid.version];
  const total = grid.cols * grid.rows;
  let state = cellState(grid, 0);
  let run = 0;
  for (let i = 0; i < total;) {
    const w = i >>> 5;
    if (
      (i & 31) === 0 &&
      i + 32 <= total &&
      grid.solid[w] === SOLID_WORD[state] &&
      grid.hard[w] === HARD_WORD[state]
    ) {
      run += 32; // 32 cells in the run's state at once
      i += 32;
      continue;
    }
    const next = cellState(grid, i++);
    if (next === state) run++;
    else {
      out.push(run * 3 + state);
      [state, run] = [next, 1];
    }
  }
  out.push(run * 3 + state);
  return out;
}

/**
 * Rebuilds a grid from `encodeGrid` output, or returns undefined when anything is off: not an array, another
 * format, a size that is not whole positive cells or is oversize, a size other than `expect`, a non-integer or
 * negative value, an empty run, or runs that do not cover the grid exactly. Never returns a partial grid.
 */
export function decodeGrid(
  data: unknown,
  expect?: Pick<Grid, "width" | "height" | "cell">,
): Grid | undefined {
  if (!Array.isArray(data) || data.length <= HEADER) return undefined;
  const values: unknown[] = data;
  const head = values.slice(0, HEADER);
  if (!head.every(isInt)) return undefined;
  const [format = 0, width = 0, height = 0, cell = 0, version = -1] = head;
  if (format !== GRID_FORMAT || version < 0) return undefined;
  if (!validSize(width, height, cell)) return undefined;
  if (
    expect &&
    [width, height, cell].join() !==
      [expect.width, expect.height, expect.cell].join()
  )
    return undefined;
  const grid = createGrid(width, height, cell);
  const total = grid.cols * grid.rows;
  if (values.length - HEADER > total) return undefined;
  grid.version = version;
  let at = 0;
  for (const v of values.slice(HEADER)) {
    if (!isInt(v) || v < 3) return undefined;
    const state = v % 3;
    const length = (v - state) / 3;
    if (length > total - at) return undefined;
    writeSpan(grid.solid, at, at + length, state !== AIR);
    writeSpan(grid.hard, at, at + length, state === HARD);
    at += length;
  }
  return at === total ? grid : undefined;
}
