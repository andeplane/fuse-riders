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
  type Point,
} from "./maps.js";
import { moveUnit } from "./motion.js";
import {
  HOLE_HALF,
  PILE_HALF,
  PILE_HEIGHT,
  QUEEN_HALF,
  QUEEN_HEIGHT,
  RUN_SPEED,
  S,
  WORKER_HALF,
  WORKER_HEIGHT,
  speedy,
} from "./tuning.js";
import type { Input, Unit } from "./types.js";
import { newUnit, unitTouches } from "./units.js";

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
/** A place to touch a hive hole or a berry pile from. */
export interface Spot {
  /** The platform to stand on, and where on it. */
  node: number;
  x: number;
  /** The move to fly from there (an index into `edges`), or -1 when standing there already touches it. */
  edge: number;
  /** Steps from the launch to the touch. */
  cost: number;
}
export interface WorkerNav {
  /** Every move the bots know: the routes between platforms first, then the hops that only reach a hole or pile. */
  edges: readonly Edge[];
  /** Indices of the route edges leaving each platform. */
  out: readonly (readonly number[])[];
  /** Cheapest steps from platform to platform; UNREACHABLE when there is no way. */
  dist: readonly (readonly number[])[];
  /** Per team and hole, and per pile: where it can be touched from. Empty when nothing reaches it. */
  holes: readonly [readonly (readonly Spot[])[], readonly (readonly Spot[])[]];
  piles: readonly (readonly Spot[])[];
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
const PER_PAIR = 3,
  PER_SPOT = 2;
/** A walking bot stops within this of where it is going. */
const STAND_SLACK = 3 * S;
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
    attack: false,
  };
}

function trialUnit(
  arena: Arena,
  from: number,
  x: number,
  speed: boolean,
): Unit {
  const unit = newUnit(2, "worker", x, arena.solids[from]!.y, from);
  unit.speed = speed;
  return unit;
}

/** A feet-anchored box a Worker wants to touch: a hive hole or a berry pile. */
interface Box {
  x: number;
  y: number;
  half: number;
  height: number;
}
const holeBox = (hole: Point): Box => ({
  x: hole.x,
  y: hole.y + HOLE_HALF,
  half: HOLE_HALF,
  height: 2 * HOLE_HALF,
});
const pileBox = (pile: Point): Box => ({
  x: pile.x,
  y: pile.y,
  half: PILE_HALF,
  height: PILE_HEIGHT,
});

interface Flight {
  /** The platform landed on (the launch platform again after a hop on the spot) and after how many steps. */
  to: number;
  cost: number;
  /** Per box, the step on which the Worker first touched it, or -1. */
  touched: number[];
}

/** Flies one move; undefined when it never leaves its platform or never lands. */
function fly(
  arena: Arena,
  edge: Edge,
  x: number,
  speed: boolean,
  boxes: readonly Box[],
): Flight | undefined {
  const unit = trialUnit(arena, edge.from, x, speed);
  const touched = boxes.map(() => -1);
  let left = false;
  for (let k = 0; k < TRIAL_STEPS; k += 1) {
    moveUnit(unit, edgeInput(edge, unit, k), arena);
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]!;
      if (
        touched[i]! < 0 &&
        unitTouches(unit, box.x, box.y, box.half, box.height)
      )
        touched[i] = k + 1;
    }
    if (unit.ground < 0) left = true;
    else if (unit.ground !== edge.from || left)
      return { to: unit.ground, cost: k + 1, touched };
  }
  return undefined;
}

const flip = (dir: -1 | 0 | 1): -1 | 0 | 1 =>
  dir === 0 ? 0 : dir < 0 ? 1 : -1;
const sameMove = (a: Edge, b: Edge): boolean =>
  a.from === b.from &&
  a.to === b.to &&
  a.x === b.x &&
  a.jump === b.jump &&
  a.first === b.first &&
  a.second === b.second;

function buildWorkerNav(arena: Arena, speed: boolean): WorkerNav {
  const count = arena.solids.length;
  const boxes = [
    ...arena.holes[0].map(holeBox),
    ...arena.holes[1].map(holeBox),
    ...arena.piles.map(pileBox),
  ];
  const launches = (edge: Edge): number[] => [
    edge.x,
    edge.x - LAUNCH_SLACK,
    edge.x + LAUNCH_SLACK,
  ];
  /** Whether `edge` reaches platform `to` from its launch point and from the slack either side of it. */
  const lands = (edge: Edge, to: number): boolean =>
    launches(edge).every((at) => fly(arena, edge, at, speed, [])?.to === to);
  /** Whether `edge` touches `box` on the way, from all three launch points; the latest first touch, or -1. */
  const touches = (edge: Edge, box: Box): number => {
    let latest = 0;
    for (const at of launches(edge)) {
      const step = fly(arena, edge, at, speed, [box])?.touched[0] ?? -1;
      if (step < 0) return -1;
      latest = Math.max(latest, step);
    }
    return latest;
  };
  const found: Edge[] = [];
  /** Moves that brush a box in flight: the box, the move and the step of the touch. */
  const brushes: { box: number; edge: Edge; cost: number }[] = [];
  for (let from = 0; from < count; from += 1) {
    const solid = arena.solids[from]!;
    const lo = solid.x + 2 * S,
      hi = solid.x + solid.w - 2 * S;
    // Nothing can stand on a platform that reaches the top of the screen or is thinner than a Worker's feet.
    if (solid.y < WORKER_HEIGHT || hi < lo) continue;
    for (let x = lo; x <= hi; x += SAMPLE) {
      if (!standable(arena, x, solid.y)) continue;
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
            const flight = fly(arena, edge, x, speed, boxes);
            if (!flight) continue;
            edge.to = flight.to;
            edge.cost = flight.cost;
            flight.touched.forEach((step, box) => {
              if (step < 0) return;
              const cost = touches(edge, boxes[box]!);
              if (cost >= 0) brushes.push({ box, edge, cost });
            });
            if (flight.to !== from && lands(edge, flight.to)) found.push(edge);
          }
    }
  }
  // The cheapest few per pair of platforms, from launch points well apart.
  found.sort(
    (a, b) => a.from - b.from || a.to - b.to || a.cost - b.cost || a.x - b.x,
  );
  const chosen: Edge[] = [];
  for (const edge of found) {
    const pair = chosen.filter((e) => e.from === edge.from && e.to === edge.to);
    if (
      pair.length < PER_PAIR &&
      pair.every((e) => Math.abs(e.x - edge.x) >= 3 * SAMPLE)
    )
      chosen.push(edge);
  }
  // The search runs left to right, so on its own it would give the two teams different routes. Every map is its own
  // mirror image and so is the motion, so the graph is made one too: a move is kept only if its mirror image also
  // lands (where two ledges meet, a landing on the very seam can count for either), and then both are in the graph.
  const twin = (index: number): number => {
    const solid = arena.solids[index]!;
    return arena.solids.findIndex(
      (other) =>
        other.y === solid.y &&
        other.w === solid.w &&
        other.h === solid.h &&
        other.x === WIDTH - solid.x - solid.w,
    );
  };
  const mirrorOf = (edge: Edge): Edge => ({
    ...edge,
    from: twin(edge.from),
    to: twin(edge.to),
    x: WIDTH - edge.x,
    first: flip(edge.first),
    second: flip(edge.second),
  });
  const edges: Edge[] = [];
  const add = (edge: Edge): number => {
    const known = edges.findIndex((e) => sameMove(e, edge));
    if (known >= 0) return known;
    edges.push(edge);
    return edges.length - 1;
  };
  for (const edge of chosen) {
    const mirror = mirrorOf(edge);
    if (!lands(mirror, mirror.to)) continue;
    add(edge);
    add(mirror);
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

  // Where to touch each box from. Standing spots first: a place on a platform where the Worker's box overlaps it.
  const spots: Spot[][] = boxes.map((box) => {
    const list: Spot[] = [];
    arena.solids.forEach((solid, node) => {
      const lo = solid.x + 2 * S,
        hi = solid.x + solid.w - 2 * S;
      if (hi < lo) return;
      const x = Math.max(lo, Math.min(hi, box.x));
      const overlaps =
        solid.y > box.y - box.height &&
        solid.y - WORKER_HEIGHT < box.y &&
        Math.abs(x - box.x) + STAND_SLACK < WORKER_HALF + box.half;
      if (overlaps && standable(arena, x, solid.y))
        list.push({ node, x, edge: -1, cost: 0 });
    });
    return list;
  });
  // Then the moves that brush it in flight, the quickest few per platform, each kept only with its mirror image.
  const holes = arena.holes[0].length;
  const twinBox = (box: number): number => {
    if (box < holes) return box + holes;
    if (box < 2 * holes) return box - holes;
    const pile = arena.piles[box - 2 * holes]!;
    return (
      2 * holes +
      arena.piles.findIndex(
        (other) => other.y === pile.y && other.x === WIDTH - pile.x,
      )
    );
  };
  brushes.sort(
    (a, b) =>
      a.box - b.box ||
      a.edge.from - b.edge.from ||
      a.cost - b.cost ||
      a.edge.x - b.edge.x,
  );
  const kept: typeof brushes = [];
  for (const brush of brushes) {
    const same = kept.filter(
      (other) => other.box === brush.box && other.edge.from === brush.edge.from,
    );
    if (
      same.length < PER_SPOT &&
      same.every((other) => Math.abs(other.edge.x - brush.edge.x) >= 3 * SAMPLE)
    )
      kept.push(brush);
  }
  const addSpot = (box: number, edge: Edge, cost: number): void => {
    const list = spots[box]!;
    // Standing there already touches it: no need to jump.
    if (list.some((spot) => spot.edge < 0 && spot.node === edge.from)) return;
    const index = add(edge);
    if (!list.some((spot) => spot.edge === index))
      list.push({ node: edge.from, x: edge.x, edge: index, cost });
  };
  for (const brush of kept) {
    const mirror = mirrorOf(brush.edge),
      other = twinBox(brush.box);
    const landing = fly(arena, mirror, mirror.x, speed, []);
    if (!landing || landing.to !== mirror.to) continue;
    const cost = touches(mirror, boxes[other]!);
    if (cost < 0) continue;
    addSpot(brush.box, brush.edge, brush.cost);
    addSpot(other, mirror, cost);
  }
  return {
    edges,
    out,
    dist,
    holes: [spots.slice(0, holes), spots.slice(holes, 2 * holes)],
    piles: spots.slice(2 * holes),
  };
}

/** Whether a Worker standing with its feet at (x, y) is clear of every platform. */
export function standable(arena: Arena, x: number, y: number): boolean {
  return !arena.solids.some((solid) =>
    [0, -WIDTH, WIDTH].some(
      (shift) =>
        x + WORKER_HALF > solid.x + shift &&
        x - WORKER_HALF < solid.x + shift + solid.w &&
        y > solid.y &&
        y - WORKER_HEIGHT < solid.y + solid.h,
    ),
  );
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

export const CELL = 6 * S;
export const COLS = WIDTH / CELL,
  ROWS = Math.ceil(HEIGHT / CELL);
const CELLS = COLS * ROWS;
export interface FlyNav {
  free: readonly boolean[];
  /** For every cell, the nearest free cell (itself when free). */
  nearest: readonly number[];
  /** Each cell's free neighbours, in plain order and in mirrored order. */
  around: readonly [
    readonly (readonly number[])[],
    readonly (readonly number[])[],
  ];
  /** Per target cell searched so far: for every cell, its neighbour on a shortest way to the target, or -1. */
  ways: Map<number, Int16Array>;
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

const MIRRORED: readonly (readonly [number, number])[] = NEIGHBOURS.map(
  ([dc, dr]) => [-dc, dr],
);

function buildFlyNav(arena: Arena): FlyNav {
  // A cell is free when a flyer centred in it, with a pixel to spare at each side and half a pixel above and below,
  // is on the screen and touches no platform.
  const half = QUEEN_HALF + S,
    reach = Math.trunc((QUEEN_HEIGHT + S) / 2);
  const free: boolean[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    const { x, y } = cellCentre(cell);
    free.push(
      y - reach >= 0 &&
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
  const neighbours = (
    cell: number,
    order: readonly (readonly [number, number])[],
  ): number[] => {
    const col = cell % COLS,
      row = Math.floor(cell / COLS);
    const open = (dc: number, dr: number): boolean =>
      row + dr >= 0 && row + dr < ROWS && free[cellIndex(col + dc, row + dr)]!;
    const list: number[] = [];
    for (const [dc, dr] of order)
      if (
        open(dc, dr) &&
        (dc === 0 || dr === 0 || (open(dc, 0) && open(0, dr)))
      )
        list.push(cellIndex(col + dc, row + dr));
    return list;
  };
  const plain = Array.from({ length: CELLS }, (_, cell) =>
      neighbours(cell, NEIGHBOURS),
    ),
    mirror = Array.from({ length: CELLS }, (_, cell) =>
      neighbours(cell, MIRRORED),
    );
  // The nearest free cell, found ring by ring. A ring is scanned from the cell's own side inward, so a tie resolves
  // the same way on both halves of the map.
  const nearest: number[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    const col = cell % COLS,
      row = Math.floor(cell / COLS);
    const side = col < COLS / 2 ? 1 : -1;
    let best = free[cell] ? cell : -1;
    for (let ring = 1; best < 0 && ring < COLS; ring += 1)
      for (let dr = -ring; dr <= ring && best < 0; dr += 1) {
        const across = ring - Math.abs(dr);
        for (const dc of across === 0 ? [0] : [-across * side, across * side]) {
          const other = cellIndex(col + dc, row + dr);
          if (row + dr >= 0 && row + dr < ROWS && free[other]) {
            best = other;
            break;
          }
        }
      }
    nearest.push(Math.max(0, best));
  }
  return { free, nearest, around: [plain, mirror], ways: new Map() };
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
 * Shortest ways to `target` from every cell, searched once per target and kept. A search from a target on the right
 * half looks at its neighbours in mirrored order, so the ways to two mirrored targets are mirror images and neither
 * team's flyers get the better line.
 */
function waysTo(nav: FlyNav, target: number): Int16Array {
  let next = nav.ways.get(target);
  if (next) return next;
  next = new Int16Array(CELLS).fill(-1);
  next[target] = target;
  const around = nav.around[target % COLS < COLS / 2 ? 0 : 1];
  const queue = [target];
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!;
    for (const other of around[cell]!)
      if (next[other]! < 0) {
        next[other] = cell;
        queue.push(other);
      }
  }
  nav.ways.set(target, next);
  return next;
}

/** Cells a flyer looks ahead along its way: far enough to fly a line, near enough not to cut through a platform. */
const AHEAD = 2;

/**
 * Where a flyer whose centre is at (x, y) should head right now to reach (tx, ty): the target itself when it is in
 * this cell or within the next few, otherwise the centre of a cell a little ahead on the shortest free way round the
 * platforms.
 */
export function flyToward(
  mapId: MapId,
  x: number,
  y: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const nav = flyNav(mapId);
  const to = nav.nearest[cellOf(tx, ty)]!;
  const next = waysTo(nav, to);
  let cell = nav.nearest[cellOf(x, y)]!;
  for (let hop = 0; hop < AHEAD; hop += 1) {
    const step = next[cell]!;
    if (cell === to || step < 0) return { x: tx, y: ty };
    cell = step;
  }
  return cell === to ? { x: tx, y: ty } : cellCentre(cell);
}
