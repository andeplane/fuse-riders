/**
 * Maps as data, in art pixels on the 480 by 270 screen (y grows downward). Every map is built from its left half and
 * mirrored, so the two sides are identical: Cyan (team 0) lives on the left, Pink (team 1) on the right. The screen
 * wraps horizontally; no platform crosses the seam, two that meet there simply form one walkway.
 */
import { S } from "./tuning.js";

export const MAP_WIDTH = 480,
  MAP_HEIGHT = 270;
export const WIDTH = MAP_WIDTH * S,
  HEIGHT = MAP_HEIGHT * S;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export type GateKind = "warrior" | "speed";
export interface GateDef extends Point {
  kind: GateKind;
}
export interface PileDef extends Point {
  count: number;
}
export type MapId = 1 | 2 | 3;
export const MAP_IDS: readonly MapId[] = [1, 2, 3];

/** Positions are feet points: a gate, pile, spawn or hole row stands on the surface at its `y`. */
export interface MapDef {
  id: MapId;
  name: string;
  /** Solid rectangles. The first is the floor the snail walks on. */
  platforms: readonly Rect[];
  /** Hive hole centres, per team. */
  holes: readonly [readonly Point[], readonly Point[]];
  gates: readonly GateDef[];
  piles: readonly PileDef[];
  /** The snail's track: its floor height, where it starts and each team's goal. */
  snail: { y: number; start: number; goals: readonly [number, number] };
  /** Spawn feet per slot: 0 and 1 are the Queens. */
  spawns: readonly Point[];
}

/** What a designer writes: the left half and whatever sits on the centre line. */
interface HalfMap {
  id: MapId;
  name: string;
  floor: Rect;
  left: readonly Rect[];
  centre: readonly Rect[];
  holes: readonly Point[];
  gatesLeft: readonly GateDef[];
  gatesCentre: readonly GateDef[];
  pilesLeft: readonly PileDef[];
  pilesCentre: readonly PileDef[];
  snail: { y: number; start: number; goal: number };
  /** Queen, first Worker, second Worker of team 0. */
  spawns: readonly [Point, Point, Point];
}

const flipX = (x: number): number => MAP_WIDTH - x;
const flipPoint = <T extends Point>(p: T): T => ({ ...p, x: flipX(p.x) });
const flipRect = (r: Rect): Rect => ({ ...r, x: MAP_WIDTH - r.x - r.w });

function mirrored(half: HalfMap): MapDef {
  const [queen, first, second] = half.spawns;
  return {
    id: half.id,
    name: half.name,
    platforms: [
      half.floor,
      ...half.left,
      ...half.left.map(flipRect),
      ...half.centre,
    ],
    holes: [half.holes, half.holes.map(flipPoint)],
    gates: [
      ...half.gatesLeft,
      ...half.gatesLeft.map(flipPoint),
      ...half.gatesCentre,
    ],
    piles: [
      ...half.pilesLeft,
      ...half.pilesLeft.map(flipPoint),
      ...half.pilesCentre,
    ],
    snail: {
      y: half.snail.y,
      start: half.snail.start,
      goals: [half.snail.goal, flipX(half.snail.goal)],
    },
    spawns: [
      queen,
      flipPoint(queen),
      first,
      flipPoint(first),
      second,
      flipPoint(second),
    ],
  };
}

const LEDGE = 6;
const ledge = (x: number, top: number, w: number): Rect => ({
  x,
  y: top,
  w,
  h: LEDGE,
});
const holeRow = (from: number, y: number, count: number): Point[] =>
  Array.from({ length: count }, (_, i) => ({ x: from + i * 10, y }));

/**
 * Map 1, "Twin Hives" (balanced). Four ledge levels 44 px apart above the snail's floor; a full Worker jump is 50 px,
 * so each level is one jump up from beside a ledge end. Hives sit on the top ledges left and right of centre, one
 * warrior gate is contested on the middle ledge and one sits on each side walkway across the seam, the speed gates
 * are low, and the snail runs along the floor between goals near the walls.
 */
const TWIN_HIVES = mirrored({
  id: 1,
  name: "Twin Hives",
  floor: { x: 0, y: 258, w: 480, h: 12 },
  left: [
    ledge(0, 214, 52),
    ledge(96, 214, 72),
    ledge(44, 170, 60),
    ledge(160, 170, 56),
    ledge(0, 126, 40),
    ledge(88, 126, 62),
    ledge(124, 82, 72),
  ],
  centre: [ledge(208, 214, 64), ledge(200, 126, 80)],
  holes: holeRow(135, 76, 6),
  gatesLeft: [
    { x: 20, y: 214, kind: "warrior" },
    { x: 132, y: 214, kind: "speed" },
  ],
  gatesCentre: [{ x: 240, y: 126, kind: "warrior" }],
  pilesLeft: [
    { x: 130, y: 258, count: 6 },
    { x: 70, y: 170, count: 6 },
    { x: 106, y: 126, count: 3 },
  ],
  pilesCentre: [{ x: 240, y: 214, count: 6 }],
  snail: { y: 258, start: 240, goal: 44 },
  spawns: [
    { x: 160, y: 82 },
    { x: 142, y: 82 },
    { x: 178, y: 82 },
  ],
});

/**
 * Map 2, "Short Leash" (snail). The goals stand much closer to the centre, so an unopposed ride takes about 20 s, and
 * the hives are pushed out to the walls where berries take longer to carry home.
 */
const SHORT_LEASH = mirrored({
  id: 2,
  name: "Short Leash",
  floor: { x: 0, y: 258, w: 480, h: 12 },
  left: [
    ledge(0, 214, 44),
    ledge(88, 214, 80),
    ledge(36, 170, 64),
    ledge(152, 170, 60),
    ledge(0, 126, 76),
    ledge(120, 126, 56),
    ledge(40, 82, 72),
  ],
  centre: [ledge(204, 214, 72), ledge(208, 126, 64)],
  holes: holeRow(51, 76, 6),
  gatesLeft: [
    { x: 140, y: 126, kind: "warrior" },
    { x: 20, y: 214, kind: "speed" },
  ],
  gatesCentre: [{ x: 240, y: 126, kind: "warrior" }],
  pilesLeft: [
    { x: 128, y: 214, count: 6 },
    { x: 180, y: 170, count: 6 },
    { x: 20, y: 126, count: 3 },
  ],
  pilesCentre: [{ x: 240, y: 214, count: 6 }],
  snail: { y: 258, start: 240, goal: 128 },
  spawns: [
    { x: 76, y: 82 },
    { x: 58, y: 82 },
    { x: 94, y: 82 },
  ],
});

/**
 * Map 3, "Open Heart" (military). Both hives share the exposed middle of the screen with no roof over them, the
 * snail's floor lies under a low tunnel roof that keeps flyers off the rider, and its goals are far apart.
 */
const OPEN_HEART = mirrored({
  id: 3,
  name: "Open Heart",
  floor: { x: 0, y: 258, w: 480, h: 12 },
  left: [
    ledge(0, 214, 36),
    ledge(80, 214, 120),
    ledge(28, 170, 56),
    ledge(128, 170, 48),
    ledge(0, 126, 32),
    ledge(72, 126, 60),
    ledge(152, 82, 72),
  ],
  centre: [ledge(216, 126, 48)],
  holes: holeRow(165, 76, 6),
  gatesLeft: [
    { x: 16, y: 126, kind: "warrior" },
    { x: 52, y: 170, kind: "speed" },
  ],
  gatesCentre: [{ x: 240, y: 126, kind: "warrior" }],
  pilesLeft: [
    { x: 140, y: 214, count: 6 },
    { x: 18, y: 214, count: 6 },
    { x: 100, y: 126, count: 3 },
  ],
  pilesCentre: [{ x: 240, y: 258, count: 6 }],
  snail: { y: 258, start: 240, goal: 24 },
  spawns: [
    { x: 188, y: 82 },
    { x: 170, y: 82 },
    { x: 206, y: 82 },
  ],
});

export const MAPS: Readonly<Record<MapId, MapDef>> = {
  1: TWIN_HIVES,
  2: SHORT_LEASH,
  3: OPEN_HEART,
};

/** A map in subpixels, as the step reads it. */
export interface Arena {
  id: MapId;
  solids: readonly Rect[];
  holes: readonly [readonly Point[], readonly Point[]];
  gates: readonly GateDef[];
  piles: readonly PileDef[];
  snail: { y: number; start: number; goals: readonly [number, number] };
  spawns: readonly Point[];
}

const scalePoint = <T extends Point>(p: T): T => ({
  ...p,
  x: p.x * S,
  y: p.y * S,
});

function compile(map: MapDef): Arena {
  return {
    id: map.id,
    solids: map.platforms.map((r) => ({
      x: r.x * S,
      y: r.y * S,
      w: r.w * S,
      h: r.h * S,
    })),
    holes: [map.holes[0].map(scalePoint), map.holes[1].map(scalePoint)],
    gates: map.gates.map(scalePoint),
    piles: map.piles.map(scalePoint),
    snail: {
      y: map.snail.y * S,
      start: map.snail.start * S,
      goals: [map.snail.goals[0] * S, map.snail.goals[1] * S],
    },
    spawns: map.spawns.map(scalePoint),
  };
}

const ARENAS: Readonly<Record<MapId, Arena>> = {
  1: compile(TWIN_HIVES),
  2: compile(SHORT_LEASH),
  3: compile(OPEN_HEART),
};

export const arenaOf = (id: MapId): Arena => ARENAS[id];
export const isMapId = (value: unknown): value is MapId =>
  value === 1 || value === 2 || value === 3;

/** Signed shortest horizontal way from `from` to `to` across the wrap, in the unit both are given in. */
export function wrapDelta(to: number, from: number, width = WIDTH): number {
  let d = (to - from) % width;
  if (d > width / 2) d -= width;
  else if (d < -width / 2) d += width;
  return d;
}

/** `x` folded into [0, width). */
export function wrapX(x: number, width = WIDTH): number {
  const m = x % width;
  return m < 0 ? m + width : m;
}
