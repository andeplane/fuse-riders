/**
 * A level: closed polygons whose edges are the ground's surface, a start and the objects to ride for. Coordinates are
 * in world units with y up; a wheel is 0.4 units in radius. A point is in the air when it is inside an odd number of
 * polygons (the outer polygon is the level's sky, a polygon inside it is a piece of ground, one inside that a cave).
 * Only the edges collide, so which side is ground matters to the picture and to the level's author, not to the rules.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}
/** What gravity an apple switches on when eaten; 0 leaves it as it is. */
export type GravityTurn = 0 | 1 | 2 | 3 | 4;
export const GRAVITY_UP = 1,
  GRAVITY_DOWN = 2,
  GRAVITY_LEFT = 3,
  GRAVITY_RIGHT = 4;
export type ObjectKind = "apple" | "flower" | "killer";
export interface LevelObject {
  readonly kind: ObjectKind;
  readonly x: number;
  readonly y: number;
  /** An apple's gravity change; absent or 0 for none. */
  readonly gravity?: GravityTurn;
}
export interface Level {
  readonly id: string;
  readonly name: string;
  readonly polygons: readonly (readonly Point[])[];
  /** Where the centre of the bike's left wheel starts. */
  readonly start: Point;
  /** The bike starts facing left; it faces right otherwise. */
  readonly faceLeft?: boolean;
  readonly objects: readonly LevelObject[];
}

/** The most apples a level may hold: a rider's eaten apples are one bit each in a BigInt set, so this is the object cap. */
export const MAX_APPLES = 64;
export const MAX_OBJECTS = 64;
export const MAX_VERTICES = 5000;
/** Levels stay inside this box, so positions and the collision grid stay bounded. */
export const WORLD_LIMIT = 500;

const CELL = 1;

/** A level prepared for the step: its edges as flat numbers and a grid of which edges pass near each cell. */
export interface Compiled {
  readonly level: Level;
  /** Four numbers per edge: x1, y1, x2, y2. */
  readonly edges: Float64Array;
  readonly minX: number;
  readonly minY: number;
  readonly cols: number;
  readonly rows: number;
  /** Edge indices by cell, row-major; empty cells share one empty list. */
  readonly cells: readonly (readonly number[])[];
  /** Indices into `level.objects` of the apples, in order: bit `n` of a rider's set is `apples[n]`. */
  readonly apples: readonly number[];
}

const finite = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value) <= WORLD_LIMIT;

/** Why `level` cannot be played, or nothing when it can. */
export function levelProblem(level: Level): string | undefined {
  let vertices = 0;
  if (level.polygons.length === 0) return "no polygons";
  for (const polygon of level.polygons) {
    if (polygon.length < 3) return "a polygon with fewer than three points";
    vertices += polygon.length;
    if (polygon.some((point) => !finite(point.x) || !finite(point.y)))
      return "a point outside the world";
  }
  if (vertices > MAX_VERTICES) return "too many points";
  if (!finite(level.start.x) || !finite(level.start.y)) return "no start";
  if (level.objects.length > MAX_OBJECTS) return "too many objects";
  if (level.objects.some((object) => !finite(object.x) || !finite(object.y)))
    return "an object outside the world";
  const apples = level.objects.filter((object) => object.kind === "apple");
  if (apples.length > MAX_APPLES) return "too many apples";
  if (!level.objects.some((object) => object.kind === "flower"))
    return "no flower";
  return undefined;
}

const EMPTY: readonly number[] = [];
const compiled = new WeakMap<Level, Compiled>();

/** `level` prepared for the step; computed once per level and derived from it alone, so it is not state. */
export function compile(level: Level): Compiled {
  const known = compiled.get(level);
  if (known) return known;
  const problem = levelProblem(level);
  if (problem) throw new Error(`level ${level.id}: ${problem}`);
  const list: number[] = [];
  for (const polygon of level.polygons)
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!,
        b = polygon[(i + 1) % polygon.length]!;
      if (a.x === b.x && a.y === b.y) continue;
      list.push(a.x, a.y, b.x, b.y);
    }
  const edges = Float64Array.from(list);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < edges.length; i += 2) {
    minX = Math.min(minX, edges[i]!);
    maxX = Math.max(maxX, edges[i]!);
    minY = Math.min(minY, edges[i + 1]!);
    maxY = Math.max(maxY, edges[i + 1]!);
  }
  minX = Math.floor(minX) - 1;
  minY = Math.floor(minY) - 1;
  const cols = Math.ceil(maxX) + 1 - minX,
    rows = Math.ceil(maxY) + 1 - minY;
  const buckets: (number[] | undefined)[] = new Array<number[] | undefined>(
    cols * rows,
  );
  for (let edge = 0; edge < edges.length / 4; edge++) {
    const x1 = edges[edge * 4]!,
      y1 = edges[edge * 4 + 1]!,
      x2 = edges[edge * 4 + 2]!,
      y2 = edges[edge * 4 + 3]!;
    // Every cell the edge's bounding box touches, grown by one so a wheel in the next cell still finds it.
    const c0 = Math.floor(Math.min(x1, x2)) - 1 - minX,
      c1 = Math.floor(Math.max(x1, x2)) + 1 - minX,
      r0 = Math.floor(Math.min(y1, y2)) - 1 - minY,
      r1 = Math.floor(Math.max(y1, y2)) + 1 - minY;
    for (let row = Math.max(0, r0); row <= Math.min(rows - 1, r1); row++)
      for (let col = Math.max(0, c0); col <= Math.min(cols - 1, c1); col++) {
        // Skip cells a long slanted edge only shares a bounding box with.
        if (!edgeNearCell(x1, y1, x2, y2, col + minX, row + minY)) continue;
        (buckets[row * cols + col] ??= []).push(edge);
      }
  }
  const apples: number[] = [];
  level.objects.forEach((object, index) => {
    if (object.kind === "apple") apples.push(index);
  });
  const result: Compiled = {
    level,
    edges,
    minX,
    minY,
    cols,
    rows,
    cells: Array.from(buckets, (bucket) => bucket ?? EMPTY),
    apples,
  };
  compiled.set(level, result);
  return result;
}

/** Whether the edge passes within one cell of the unit cell at (`cx`, `cy`). */
function edgeNearCell(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
): boolean {
  // Distance from the cell's centre to the edge against the cell's half diagonal plus the margin.
  const px = cx + CELL / 2,
    py = cy + CELL / 2;
  const dx = x2 - x1,
    dy = y2 - y1;
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)),
  );
  const ex = x1 + t * dx - px,
    ey = y1 + t * dy - py;
  const reach = CELL * 0.7072 + CELL;
  return ex * ex + ey * ey <= reach * reach;
}

/** The edges that may come within one unit of (`x`, `y`): the list of the cell it is in. */
export function edgesNear(
  level: Compiled,
  x: number,
  y: number,
): readonly number[] {
  const col = Math.floor(x) - level.minX,
    row = Math.floor(y) - level.minY;
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows)
    return EMPTY;
  return level.cells[row * level.cols + col]!;
}

/** Whether (`x`, `y`) is in the air: inside an odd number of polygons. */
export function inAir(level: Level, x: number, y: number): boolean {
  let inside = false;
  for (const polygon of level.polygons)
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!,
        b = polygon[j]!;
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  return inside;
}
