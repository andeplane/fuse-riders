/**
 * The railway of a `trains` round, laid fresh every round from the round's seeded stream.
 *
 * Each line is the outline of a random blob of grid cells: grown a cell at a time, preferring cells that stretch an
 * arm out over cells that fatten the blob, so a line winds, doubles back on itself in hairpins and wraps round bays.
 * A blob never gets a hole or two cells touching only at a corner, so its outline is one simple loop, and lines keep
 * a cell of open ground between them, so no two lines meet and trains on different lines never touch. Every train on
 * a line runs the same way at the same speed, evenly spaced, so trains on one line never meet either.
 *
 * Lines keep clear of every rider's opening run (the spawn capsules the sampled maps keep clear), so nobody starts in
 * front of a train; anywhere else is fair game. The tracks are state (`GameState.tracks`): a checkpoint carries them,
 * and replay and rollback lay the same railway because it is drawn from the shared stream in a fixed order.
 */
import type { ClearCapsule, Obstacle } from "./arena-map.js";
import { hypot2 } from "./deterministic-math.js";
import { segmentDistanceSquared } from "./geometry.js";
import {
  TRAIN_CAR_HALF_SIZE,
  TRAIN_CAR_SPACING,
  trackLength,
  trackPose,
  type Track,
  type TrackPoint,
} from "./scenery-motion.js";
import { wrapCoordinate } from "./wrap.js";

/**
 * Track runs along the lines of this grid, which spans x 160..1440 and y 150..750 of the 1600x900 board: at least a
 * hundred units of open ground between any car and the classic wall.
 */
export const RAIL_GRID = Object.freeze({
  x: 160,
  y: 150,
  cellWidth: 80,
  cellHeight: 75,
  columns: 16,
  rows: 8,
});
/** Corners are cut this far along each rail, under half the shortest grid edge, so every cut leaves some straight. */
export const RAIL_CHAMFER = 24;
export const MIN_LINES = 2;
export const MAX_TRACKS = 4;
export const MIN_LINE_CELLS = 5;
export const MAX_LINE_CELLS = 26;
/** Two points per corner, and a blob of `MAX_LINE_CELLS` cells has at most 54 corners. */
export const MAX_TRACK_POINTS = 128;
export const MIN_TRAINS = 5;
export const MAX_TRAINS = 8;
/** Trains the generator lays; `MAX_TRAINS` is the checkpoint's bound, with room to spare. */
export const MAX_LAID_TRAINS = 7;
export const MIN_CARS = 3;
export const MAX_CARS = 5;
/**
 * Units per tick a line's trains run at, one drawn per line: 100 to 150 a second, against a rider's 150 at the start
 * of a round, so the fastest expresses keep pace with a fresh rider. A car moves at most 7.5 a tick against its 32
 * width, so nothing tunnels through one.
 */
export const TRAIN_SPEEDS: readonly number[] = Object.freeze([
  5, 5.5, 6, 6.5, 7, 7.5,
]);
/** Open track behind a train before the next one on its line: two car lengths. */
export const TRAIN_HEADWAY = 2 * TRAIN_CAR_SPACING;
/** How far a car's square reaches from the rail it is centred on, whichever way the rail runs. */
const CAR_REACH = hypot2(TRAIN_CAR_HALF_SIZE, TRAIN_CAR_HALF_SIZE);
/** Seed cells tried before the railway settles for the lines it has. */
const LINE_ATTEMPTS = 24;
/** A cell at an arm's tip (one neighbour in the blob all round it) is this many times likelier to be grown than any other. */
const ARM_WEIGHT = 4;

export interface TrainSpec {
  track: number;
  cars: number;
  /** Signed units per tick; the sign is the way round the loop. */
  speed: number;
  /** Where the locomotive starts, as distance round the loop. */
  start: number;
}

export interface Railway {
  tracks: Track[];
  trains: TrainSpec[];
}

const CELLS = RAIL_GRID.columns * RAIL_GRID.rows;
const column = (cell: number): number => cell % RAIL_GRID.columns;
const row = (cell: number): number => Math.floor(cell / RAIL_GRID.columns);
const cellAt = (c: number, r: number): number | undefined =>
  c < 0 || r < 0 || c >= RAIL_GRID.columns || r >= RAIL_GRID.rows
    ? undefined
    : r * RAIL_GRID.columns + c;

/** The eight neighbours round a cell in ring order, the orthogonal ones at even positions: N, NE, E, SE, S, SW, W, NW. */
const RING: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * How many of the blob's cells stand round `cell`, when adding it keeps the blob one piece with an outline that is a
 * single simple loop; undefined when it would not. The blob's cells round it must form one unbroken run (two runs
 * would close a ring round some outside ground: a hole), and that run must not be a lone corner neighbour (a corner
 * contact pinches the outline into a figure of eight).
 */
function neighboursIfSimple(
  blob: ReadonlySet<number>,
  cell: number,
): number | undefined {
  const c = column(cell),
    r = row(cell);
  const inBlob = RING.map(([dc, dr]) => {
    const other = cellAt(c + dc, r + dr);
    return other !== undefined && blob.has(other);
  });
  let runs = 0,
    count = 0,
    first = -1;
  for (let index = 0; index < 8; index += 1) {
    if (!inBlob[index]) continue;
    count += 1;
    if (!inBlob[(index + 7) % 8]) {
      runs += 1;
      first = index;
    }
  }
  if (runs !== 1 || (count === 1 && first % 2 === 1)) return undefined;
  return count;
}

/** Grows a blob from `start` toward `size` cells, by cells `open` admits; stops early when nothing more can be grown. */
function growBlob(
  start: number,
  size: number,
  random: () => number,
  open: (cell: number) => boolean,
): Set<number> {
  const blob = new Set([start]);
  while (blob.size < size) {
    const candidates: number[] = [],
      weights: number[] = [];
    let total = 0;
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (blob.has(cell) || !open(cell)) continue;
      const neighbours = neighboursIfSimple(blob, cell);
      if (neighbours === undefined) continue;
      // A lone neighbour is the tip of an arm: growing there stretches the arm on rather than fattening the blob.
      const weight = neighbours === 1 ? ARM_WEIGHT : 1;
      candidates.push(cell);
      weights.push(weight);
      total += weight;
    }
    if (candidates.length === 0) break;
    let pick = random() * total,
      chosen = candidates[candidates.length - 1]!;
    for (let index = 0; index < candidates.length; index += 1) {
      pick -= weights[index]!;
      if (pick < 0) {
        chosen = candidates[index]!;
        break;
      }
    }
    blob.add(chosen);
  }
  return blob;
}

/**
 * The blob's outline as its corners, clockwise on screen (y grows downwards) from its top-left-most corner; undefined
 * when the outline is not one simple loop, which `neighboursIfSimple` already rules out.
 */
function outline(blob: ReadonlySet<number>): TrackPoint[] | undefined {
  const stride = RAIL_GRID.columns + 1;
  const vertex = (c: number, r: number): number => r * stride + c;
  const inside = (c: number, r: number): boolean => {
    const cell = cellAt(c, r);
    return cell !== undefined && blob.has(cell);
  };
  // Each boundary edge, directed with the blob on its right, keyed by the vertex it leaves.
  const next = new Map<number, number>();
  const edge = (from: number, to: number): boolean => {
    if (next.has(from)) return false;
    next.set(from, to);
    return true;
  };
  for (const cell of [...blob].sort((a, b) => a - b)) {
    const c = column(cell),
      r = row(cell);
    if (!inside(c, r - 1) && !edge(vertex(c, r), vertex(c + 1, r)))
      return undefined;
    if (!inside(c + 1, r) && !edge(vertex(c + 1, r), vertex(c + 1, r + 1)))
      return undefined;
    if (!inside(c, r + 1) && !edge(vertex(c + 1, r + 1), vertex(c, r + 1)))
      return undefined;
    if (!inside(c - 1, r) && !edge(vertex(c, r + 1), vertex(c, r)))
      return undefined;
  }
  const start = Math.min(...next.keys());
  const loop: number[] = [start];
  for (let at = next.get(start)!; at !== start; at = next.get(at)!) {
    loop.push(at);
    if (loop.length > next.size) return undefined;
  }
  if (loop.length !== next.size) return undefined; // an inner edge left over: a hole
  const point = (id: number): TrackPoint => ({
    x: RAIL_GRID.x + (id % stride) * RAIL_GRID.cellWidth,
    y: RAIL_GRID.y + Math.floor(id / stride) * RAIL_GRID.cellHeight,
  });
  const corners: TrackPoint[] = [];
  loop.forEach((id, index) => {
    const before = point(loop[(index + loop.length - 1) % loop.length]!),
      here = point(id),
      after = point(loop[(index + 1) % loop.length]!);
    const straight =
      (before.x === here.x && here.x === after.x) ||
      (before.y === here.y && here.y === after.y);
    if (!straight) corners.push(here);
  });
  return corners;
}

/** Each corner cut by `RAIL_CHAMFER` along both rails meeting there; the rails are axis-aligned, so the cut is too. */
function chamfer(corners: readonly TrackPoint[]): Track {
  const points: TrackPoint[] = [];
  const toward = (from: number, to: number): number =>
    Math.sign(to - from) * RAIL_CHAMFER;
  corners.forEach((here, index) => {
    const before = corners[(index + corners.length - 1) % corners.length]!,
      after = corners[(index + 1) % corners.length]!;
    points.push(
      {
        x: here.x + toward(here.x, before.x),
        y: here.y + toward(here.y, before.y),
      },
      {
        x: here.x + toward(here.x, after.x),
        y: here.y + toward(here.y, after.y),
      },
    );
  });
  return { points };
}

/** Distance from a capsule's spine to a grid cell, squared: zero when the spine crosses or ends inside the cell. */
function cellCapsuleDistanceSquared(
  cell: number,
  capsule: ClearCapsule,
): number {
  const minX = RAIL_GRID.x + column(cell) * RAIL_GRID.cellWidth,
    minY = RAIL_GRID.y + row(cell) * RAIL_GRID.cellHeight,
    maxX = minX + RAIL_GRID.cellWidth,
    maxY = minY + RAIL_GRID.cellHeight;
  const within = (x: number, y: number): boolean =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (within(capsule.x1, capsule.y1) || within(capsule.x2, capsule.y2))
    return 0;
  const { x1, y1, x2, y2 } = capsule;
  return Math.min(
    segmentDistanceSquared(x1, y1, x2, y2, minX, minY, maxX, minY),
    segmentDistanceSquared(x1, y1, x2, y2, maxX, minY, maxX, maxY),
    segmentDistanceSquared(x1, y1, x2, y2, maxX, maxY, minX, maxY),
    segmentDistanceSquared(x1, y1, x2, y2, minX, maxY, minX, minY),
  );
}

/** Whether no car anywhere on the track can touch any of the capsules. */
export function trackKeepsClear(
  track: Track,
  keepClear: readonly ClearCapsule[],
): boolean {
  const { points } = track;
  return points.every((from, index) => {
    const to = points[(index + 1) % points.length]!;
    return keepClear.every((capsule) => {
      const reach = capsule.radius + CAR_REACH;
      return (
        segmentDistanceSquared(
          from.x,
          from.y,
          to.x,
          to.y,
          capsule.x1,
          capsule.y1,
          capsule.x2,
          capsule.y2,
        ) >=
        reach * reach
      );
    });
  });
}

/**
 * The track a train of `cars` cars needs to itself on a line where trains are evenly spaced: its own length and its
 * headway to the next one.
 */
const trainSlot = (cars: number): number =>
  cars * TRAIN_CAR_SPACING + TRAIN_HEADWAY;

/**
 * The trains: between `MIN_TRAINS` and `MAX_LAID_TRAINS`. First how many each line runs — one on every line, then
 * each further one on the line with the most track per train, while a train of the shortest length still fits — and
 * then each train's length, drawn and cut short to the room its line's spacing leaves. Two of the shortest lines a
 * railway can lay (about 690 units each) hold three trains apiece, so two lines always carry the minimum.
 */
function timetable(
  tracks: readonly Track[],
  random: () => number,
): TrainSpec[] {
  const lengths = tracks.map(trackLength);
  const lines = tracks.map(() => ({
    speed:
      TRAIN_SPEEDS[Math.floor(random() * TRAIN_SPEEDS.length)]! *
      (random() < 0.5 ? -1 : 1),
    phase: random(),
    trains: 0,
  }));
  const wanted =
    MIN_TRAINS + Math.floor(random() * (MAX_LAID_TRAINS - MIN_TRAINS + 1));
  for (let train = 0; train < wanted; train += 1) {
    let best = -1,
      bestEmpty = false,
      bestShare = 0;
    lines.forEach((line, index) => {
      const share = lengths[index]! / (line.trains + 1),
        empty = line.trains === 0;
      if (share < trainSlot(MIN_CARS)) return;
      if (
        best < 0 ||
        (empty && !bestEmpty) ||
        (empty === bestEmpty && share > bestShare)
      ) {
        best = index;
        bestEmpty = empty;
        bestShare = share;
      }
    });
    if (best < 0) break;
    lines[best]!.trains += 1;
  }
  return lines.flatMap((line, index) => {
    const spacing = lengths[index]! / line.trains;
    const room = Math.floor((spacing - TRAIN_HEADWAY) / TRAIN_CAR_SPACING);
    return Array.from({ length: line.trains }, (_, position) => ({
      track: index,
      cars: Math.min(
        room,
        MIN_CARS + Math.floor(random() * (MAX_CARS - MIN_CARS + 1)),
      ),
      speed: line.speed,
      start:
        ((line.phase + position / line.trains) * lengths[index]!) %
        lengths[index]!,
    }));
  });
}

/** The outermost two columns on one side of the grid: no spawn corridor ever reaches that far out. */
function sidingCells(left: boolean): number[] {
  const cells: number[] = [];
  for (let r = 0; r < RAIL_GRID.rows; r += 1)
    for (const c of left
      ? [0, 1]
      : [RAIL_GRID.columns - 2, RAIL_GRID.columns - 1])
      cells.push(cellAt(c, r)!);
  return cells;
}

/** The loop round `sidingCells`: a plain chamfered rectangle. */
function siding(left: boolean): Track {
  const c = left ? 0 : RAIL_GRID.columns - 2;
  const minX = RAIL_GRID.x + c * RAIL_GRID.cellWidth,
    maxX = minX + 2 * RAIL_GRID.cellWidth,
    minY = RAIL_GRID.y,
    maxY = RAIL_GRID.y + RAIL_GRID.rows * RAIL_GRID.cellHeight;
  return chamfer([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]);
}

/**
 * The round's railway, drawn from `random` (the game's seeded stream): how many lines, then each line's seed cell,
 * size and growth, then each line's speed, direction and phase, then how many trains and each train's cars. The
 * number of draws depends only on the values drawn, so every replica lays the same railway.
 */
export function layRailway(
  random: () => number,
  keepClear: readonly ClearCapsule[],
): Railway {
  const blocked = new Set<number>();
  for (let cell = 0; cell < CELLS; cell += 1)
    if (
      keepClear.some((capsule) => {
        const reach = capsule.radius + CAR_REACH;
        return cellCapsuleDistanceSquared(cell, capsule) < reach * reach;
      })
    )
      blocked.add(cell);
  // A line's cells and the ring round them: the next line keeps a cell of open ground away.
  const claimed = new Set<number>();
  const open = (cell: number): boolean =>
    !blocked.has(cell) && !claimed.has(cell);
  const lineCount =
    MIN_LINES + Math.floor(random() * (MAX_TRACKS - MIN_LINES + 1));
  const tracks: Track[] = [];
  for (
    let attempt = 0;
    attempt < LINE_ATTEMPTS && tracks.length < lineCount;
    attempt += 1
  ) {
    const free: number[] = [];
    for (let cell = 0; cell < CELLS; cell += 1) if (open(cell)) free.push(cell);
    if (free.length === 0) break;
    const start = free[Math.floor(random() * free.length)]!;
    const size =
      MIN_LINE_CELLS +
      Math.floor(random() * (MAX_LINE_CELLS - MIN_LINE_CELLS + 1));
    const blob = growBlob(start, size, random, open);
    if (blob.size < MIN_LINE_CELLS) continue;
    const corners = outline(blob);
    if (!corners) continue;
    const track = chamfer(corners);
    if (!trackKeepsClear(track, keepClear)) continue;
    tracks.push(track);
    for (const cell of blob)
      for (const [dc, dr] of [[0, 0] as const, ...RING]) {
        const other = cellAt(column(cell) + dc, row(cell) + dr);
        if (other !== undefined) claimed.add(other);
      }
  }
  // A board too crowded for the lines it wanted makes up the minimum with sidings, far outside every spawn corridor,
  // wherever no line has claimed the ground.
  for (const left of [true, false]) {
    if (tracks.length >= MIN_LINES) break;
    const cells = sidingCells(left);
    if (cells.some((cell) => claimed.has(cell))) continue;
    tracks.push(siding(left));
    for (const cell of cells) claimed.add(cell);
  }
  return { tracks, trains: timetable(tracks, random) };
}

/**
 * The cars of a railway's trains as obstacles, ids continuing from `firstId`. Cars are laid head first, so within a
 * train the lowest id is the locomotive and the highest the last car.
 */
export function railwayCars(railway: Railway, firstId: number): Obstacle[] {
  let id = firstId;
  const cars: Obstacle[] = [];
  railway.trains.forEach((train, index) => {
    const track = railway.tracks[train.track]!;
    const length = trackLength(track);
    const behind = train.speed < 0 ? -1 : 1;
    for (let car = 0; car < train.cars; car += 1) {
      const along = wrapCoordinate(
        train.start - car * TRAIN_CAR_SPACING * behind,
        length,
      );
      const pose = trackPose(track, along);
      cars.push({
        id: id++,
        kind: "train",
        x: pose.x,
        y: pose.y,
        halfWidth: TRAIN_CAR_HALF_SIZE,
        halfHeight: TRAIN_CAR_HALF_SIZE,
        motion: {
          kind: "rail",
          track: train.track,
          along,
          speed: train.speed,
          train: index,
        },
      });
    }
  });
  return cars;
}
