/**
 * Bot navigation. Two things are derived from a map, once, and cached: a graph of ledge-to-ledge moves for Workers,
 * and a coarse grid of free cells with shortest paths for the flyers. The Worker graph is found, not drawn: every
 * plausible move is flown through the real `moveUnit`, and a move is kept only if it lands on the same ledge from a
 * pixel either side of its launch point too. Both are pure functions of the map and the tuning using integer
 * arithmetic, so every peer derives the same tables; they are not round state.
 */
import {
  HEIGHT,
  WIDTH,
  arenaOf,
  wrapDelta,
  wrapX,
  type Arena,
  type MapId,
} from "./maps.js";
import { moveUnit } from "./motion.js";
import { QUEEN_HALF, QUEEN_HEIGHT, RUN_SPEED, S, speedy } from "./tuning.js";
import type { Input, Unit } from "./types.js";

// --- Worker graph ---------------------------------------------------------------------------------------------------

export const JUMP_NONE = 0,
  JUMP_SHORT = 1,
  JUMP_FULL = 2;
export interface Edge {
  from: number;
  to: number;
  /** Launch point on `from`, subpixels. */
  x: number;
  jump: number;
  /** Direction held from the launch, and from the top of the arc on. */
  first: -1 | 0 | 1;
  second: -1 | 0 | 1;
  /** Steps from a standing launch to the landing. */
  cost: number;
}
export interface WorkerNav {
  edges: readonly Edge[];
  /** Edge indices leaving each platform. */
  out: readonly (readonly number[])[];
  /** Cheapest steps from platform to platform; UNREACHABLE when there is no way. */
  dist: readonly (readonly number[])[];
}
export const UNREACHABLE = 1_000_000;
/** Steps a short jump holds the button. */
const SHORT_HOLD = 6;
/** Steps before a move may change to its second direction. */
const TURN_AFTER = 6;
const TRIAL_STEPS = 170;
const SAMPLE = 4 * S;
/** A launch must also work from this far either side: the pilot stops within it. */
export const LAUNCH_SLACK = Math.trunc((S * 6) / 5);
const PER_PAIR = 3;
const DIRS = [-1, 0, 1] as const;

/** The controls that fly `edge`, `k` steps after its launch. The trials and the pilot share this function. */
export function edgeInput(edge: Edge, unit: Unit, k: number): Input {
  const turned = unit.ground < 0 && unit.vy >= 0 && k >= TURN_AFTER;
  const dir = turned ? edge.second : edge.first;
  return {
    left: dir < 0,
    right: dir > 0,
    down: false,
    held:
      edge.jump === JUMP_FULL || (edge.jump === JUMP_SHORT && k < SHORT_HOLD),
    pressed: k === 0 && edge.jump !== JUMP_NONE,
  };
}

function trialUnit(
  arena: Arena,
  from: number,
  x: number,
  speed: boolean,
): Unit {
  return {
    slot: 2,
    team: 0,
    kind: "worker",
    speed,
    x,
    y: arena.solids[from]!.y,
    vx: 0,
    vy: 0,
    facing: 1,
    ground: from,
    coyote: 0,
    jumping: false,
    flapped: false,
    diving: false,
    carrying: false,
    gate: -1,
    gateProgress: 0,
    invuln: 0,
    dead: false,
    respawn: 0,
    riding: false,
    eaten: false,
    mountWait: 0,
  };
}

/** Flies one move; returns where it lands and after how many steps, or undefined when it never leaves or lands. */
function fly(
  arena: Arena,
  edge: Edge,
  x: number,
  speed: boolean,
): { to: number; cost: number } | undefined {
  const unit = trialUnit(arena, edge.from, x, speed);
  let left = false;
  for (let k = 0; k < TRIAL_STEPS; k += 1) {
    moveUnit(unit, edgeInput(edge, unit, k), arena);
    if (unit.ground < 0) left = true;
    else if (unit.ground !== edge.from) return { to: unit.ground, cost: k + 1 };
    else if (left) return undefined;
  }
  return undefined;
}

function buildWorkerNav(arena: Arena, speed: boolean): WorkerNav {
  const count = arena.solids.length;
  const found: Edge[] = [];
  for (let from = 0; from < count; from += 1) {
    const solid = arena.solids[from]!;
    const lo = solid.x + 2 * S,
      hi = solid.x + solid.w - 2 * S;
    for (let x = lo; x <= hi; x += SAMPLE)
      for (const jump of [JUMP_NONE, JUMP_SHORT, JUMP_FULL])
        for (const first of DIRS)
          for (const second of DIRS) {
            // A walk-off needs a direction, and only makes sense from near the end it walks toward.
            if (jump === JUMP_NONE) {
              if (first === 0) continue;
              if (first < 0 ? x > lo + SAMPLE : x < hi - SAMPLE) continue;
            }
            const edge: Edge = {
              from,
              to: -1,
              x,
              jump,
              first,
              second,
              cost: 0,
            };
            const landing = fly(arena, edge, x, speed);
            if (!landing) continue;
            const same = (at: number): boolean =>
              fly(arena, edge, at, speed)?.to === landing.to;
            if (!same(x - LAUNCH_SLACK) || !same(x + LAUNCH_SLACK)) continue;
            edge.to = landing.to;
            edge.cost = landing.cost;
            found.push(edge);
          }
  }
  // The cheapest few per pair of platforms, from launch points well apart.
  found.sort(
    (a, b) => a.from - b.from || a.to - b.to || a.cost - b.cost || a.x - b.x,
  );
  const edges: Edge[] = [];
  for (const edge of found) {
    const pair = edges.filter((e) => e.from === edge.from && e.to === edge.to);
    if (
      pair.length < PER_PAIR &&
      pair.every((e) => Math.abs(e.x - edge.x) >= 3 * SAMPLE)
    )
      edges.push(edge);
  }
  const out: number[][] = Array.from({ length: count }, () => []);
  const dist: number[][] = Array.from({ length: count }, (_, i) =>
    Array.from({ length: count }, (_, j) => (i === j ? 0 : UNREACHABLE)),
  );
  // Every hop also costs a short walk to its launch point.
  const WALK = 30;
  edges.forEach((edge, index) => {
    out[edge.from]!.push(index);
    const row = dist[edge.from]!;
    row[edge.to] = Math.min(row[edge.to]!, edge.cost + WALK);
  });
  for (let k = 0; k < count; k += 1)
    for (let i = 0; i < count; i += 1)
      for (let j = 0; j < count; j += 1) {
        const via = dist[i]![k]! + dist[k]![j]!;
        if (via < dist[i]![j]!) dist[i]![j] = via;
      }
  return { edges, out, dist };
}

const workerNavs = new Map<string, WorkerNav>();
export function workerNav(mapId: MapId, speed: boolean): WorkerNav {
  const key = `${mapId}:${speed ? 1 : 0}`;
  let nav = workerNavs.get(key);
  if (!nav) {
    nav = buildWorkerNav(arenaOf(mapId), speed);
    workerNavs.set(key, nav);
  }
  return nav;
}

/** The platform whose top is the surface at feet point (x, y), or -1. */
export function platformAt(arena: Arena, x: number, y: number): number {
  const at = wrapX(x);
  for (let i = 0; i < arena.solids.length; i += 1) {
    const solid = arena.solids[i]!;
    if (solid.y === y && at >= solid.x && at <= solid.x + solid.w) return i;
  }
  return -1;
}

/** The platform directly below (x, y): the surface something at that point stands over, or -1. */
export function platformBelow(arena: Arena, x: number, y: number): number {
  const at = wrapX(x);
  let best = -1;
  for (let i = 0; i < arena.solids.length; i += 1) {
    const solid = arena.solids[i]!;
    if (at < solid.x || at > solid.x + solid.w || solid.y < y) continue;
    if (best < 0 || solid.y < arena.solids[best]!.y) best = i;
  }
  return best;
}

/**
 * The edge to take from platform `from`, standing at `x`, toward platform `to`: the one with the least walking,
 * flying and remaining way. -1 when there is none.
 */
export function nextEdge(
  nav: WorkerNav,
  from: number,
  x: number,
  to: number,
  speed: boolean,
): number {
  let best = -1,
    bestCost = UNREACHABLE;
  const pace = speedy(RUN_SPEED, speed);
  for (const index of nav.out[from] ?? []) {
    const edge = nav.edges[index]!;
    const cost =
      Math.trunc(Math.abs(wrapDelta(edge.x, x)) / pace) +
      edge.cost +
      nav.dist[edge.to]![to]!;
    if (cost < bestCost) {
      best = index;
      bestCost = cost;
    }
  }
  return best;
}

// --- Flyer grid -----------------------------------------------------------------------------------------------------

export const CELL = 12 * S;
export const COLS = WIDTH / CELL,
  ROWS = Math.ceil(HEIGHT / CELL);
const CELLS = COLS * ROWS;
export interface FlyNav {
  free: readonly boolean[];
  /** For every cell, the nearest free cell (itself when free). */
  nearest: readonly number[];
  /** `next[target * CELLS + cell]`: the neighbour of `cell` on a shortest way to `target`, or -1. */
  next: Int16Array;
}

const cellIndex = (col: number, row: number): number =>
  row * COLS + (((col % COLS) + COLS) % COLS);
export const cellOf = (x: number, y: number): number =>
  cellIndex(
    Math.floor(wrapX(x) / CELL),
    Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))),
  );
/** A cell's centre in subpixels. */
export const cellCentre = (cell: number): { x: number; y: number } => ({
  x: (cell % COLS) * CELL + CELL / 2,
  y: Math.floor(cell / COLS) * CELL + CELL / 2,
});

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function buildFlyNav(arena: Arena): FlyNav {
  // A cell is free when a Queen with a pixel to spare, centred in it, touches no platform.
  const half = QUEEN_HALF + S,
    reach = QUEEN_HEIGHT / 2 + S;
  const free: boolean[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    const { x, y } = cellCentre(cell);
    free.push(
      y + reach <= HEIGHT &&
        !arena.solids.some((solid) =>
          [0, -WIDTH, WIDTH].some(
            (shift) =>
              x + half > solid.x + shift &&
              x - half < solid.x + shift + solid.w &&
              y + reach > solid.y &&
              y - reach < solid.y + solid.h,
          ),
        ),
    );
  }
  const neighbours = (cell: number): number[] => {
    const col = cell % COLS,
      row = Math.floor(cell / COLS);
    const open = (dc: number, dr: number): boolean =>
      row + dr >= 0 && row + dr < ROWS && free[cellIndex(col + dc, row + dr)]!;
    const list: number[] = [];
    for (const [dc, dr] of NEIGHBOURS)
      if (
        open(dc, dr) &&
        (dc === 0 || dr === 0 || (open(dc, 0) && open(0, dr)))
      )
        list.push(cellIndex(col + dc, row + dr));
    return list;
  };
  const around = Array.from({ length: CELLS }, (_, cell) => neighbours(cell));
  const next = new Int16Array(CELLS * CELLS).fill(-1);
  for (let target = 0; target < CELLS; target += 1) {
    if (!free[target]) continue;
    const base = target * CELLS;
    next[base + target] = target;
    const queue = [target];
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head]!;
      for (const other of around[cell]!)
        if (next[base + other]! < 0) {
          next[base + other] = cell;
          queue.push(other);
        }
    }
  }
  const nearest: number[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    const here = cellCentre(cell);
    let best = cell,
      bestDistance = free[cell] ? 0 : UNREACHABLE * S;
    if (!free[cell])
      for (let other = 0; other < CELLS; other += 1) {
        if (!free[other]) continue;
        const there = cellCentre(other);
        const distance =
          Math.abs(wrapDelta(there.x, here.x)) + Math.abs(there.y - here.y);
        if (distance < bestDistance) {
          best = other;
          bestDistance = distance;
        }
      }
    nearest.push(best);
  }
  return { free, nearest, next };
}

const flyNavs = new Map<MapId, FlyNav>();
export function flyNav(mapId: MapId): FlyNav {
  let nav = flyNavs.get(mapId);
  if (!nav) {
    nav = buildFlyNav(arenaOf(mapId));
    flyNavs.set(mapId, nav);
  }
  return nav;
}

/**
 * Where a flyer whose centre is at (x, y) should head right now to reach (tx, ty): the target itself when it is in
 * this cell or the next, otherwise the centre of the next cell on the shortest free way round the platforms.
 */
export function flyToward(
  mapId: MapId,
  x: number,
  y: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const nav = flyNav(mapId);
  const from = nav.nearest[cellOf(x, y)]!,
    to = nav.nearest[cellOf(tx, ty)]!;
  const step = nav.next[to * CELLS + from] ?? -1;
  if (from === to || step === to || step < 0) return { x: tx, y: ty };
  return cellCentre(step);
}
