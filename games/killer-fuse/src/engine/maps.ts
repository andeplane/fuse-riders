/**
 * Maps as data, in art pixels on the 480 by 270 screen (y grows downward). The three layouts are ports of the
 * arcade's day, dusk and night maps, measured from footage (docs/balance.md); only the geometry is taken. Every map
 * is built from its left half and mirrored, so the two sides are identical: team 0 lives on the left, team 1 on the
 * right. The screen wraps horizontally; no platform crosses the seam, two that meet there simply form one walkway.
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
  /** Grows down from the surface above it instead of standing on one. */
  hanging: boolean;
}
export type MapId = 1 | 2 | 3;
export const MAP_IDS: readonly MapId[] = [1, 2, 3];

/**
 * Positions are feet points: a gate, pile, spawn or egg stands on the surface at its `y`. A hanging pile grows down
 * from the underside of a platform or from the top of the screen; its `y` is still the bottom of its box.
 */
export interface MapDef {
  id: MapId;
  name: string;
  /** Solid rectangles. The first is the floor the snail walks on. */
  platforms: readonly Rect[];
  /** Hive hole centres, per team. */
  holes: readonly [readonly Point[], readonly Point[]];
  /** The wall each team's holes are set in. It is scenery: nothing collides with it. */
  hiveWalls: readonly [Rect, Rect];
  /** Where each team's two spare Queen eggs stand (feet points); the third has hatched when a round starts. */
  eggSpots: readonly [readonly Point[], readonly Point[]];
  gates: readonly GateDef[];
  piles: readonly PileDef[];
  /** The snail's track: its floor height, where it starts and each team's goal. */
  snail: { y: number; start: number; goals: readonly [number, number] };
  /** The net cage standing over each team's snail goal. Scenery as well. */
  nets: readonly [Rect, Rect];
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
  hive: { wall: Rect; holes: readonly Point[]; eggs: readonly Point[] };
  gatesLeft: readonly GateDef[];
  gatesCentre: readonly GateDef[];
  pilesLeft: readonly PileDef[];
  pilesCentre: readonly PileDef[];
  snail: { y: number; start: number; goal: number };
  net: Rect;
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
    holes: [half.hive.holes, half.hive.holes.map(flipPoint)],
    hiveWalls: [half.hive.wall, flipRect(half.hive.wall)],
    eggSpots: [half.hive.eggs, half.hive.eggs.map(flipPoint)],
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
    nets: [half.net, flipRect(half.net)],
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

/** Platform thickness, and the size of a pile's box (tuning.ts keeps the same numbers in subpixels). */
const LEDGE = 6,
  PILE = 12,
  BERRIES = 6;
/** The ledges of one level: their shared top and each one's left and right end. */
const level = (
  top: number,
  ...spans: readonly (readonly [number, number])[]
): Rect[] =>
  spans.map(([from, to]) => ({ x: from, y: top, w: to - from, h: LEDGE }));
/** A ledge centred on the screen, from `from` to its mirror image. */
const middle = (top: number, from: number, h = LEDGE): Rect => ({
  x: from,
  y: top,
  w: MAP_WIDTH - 2 * from,
  h,
});
const gate = (kind: GateKind, x: number, y: number): GateDef => ({
  x,
  y,
  kind,
});
/** Six berries standing on the surface at `y`. */
const pile = (x: number, y: number): PileDef => ({
  x,
  y,
  count: BERRIES,
  hanging: false,
});
/** Six berries hanging under the surface whose underside is at `under` (0 for the top of the screen). */
const hanging = (x: number, under: number): PileDef => ({
  x,
  y: under + PILE,
  count: BERRIES,
  hanging: true,
});
/**
 * A hive's twelve holes: five columns `pitch` apart around `x`, staggered 2-3-2-3-2. `rows` are five heights above
 * `floor`, lowest first: the second and fourth column take the first, third and fifth, the others the two between.
 */
const comb = (
  x: number,
  floor: number,
  pitch: number,
  rows: readonly [number, number, number, number, number],
): Point[] =>
  [-2, -1, 0, 1, 2].flatMap((column) =>
    rows
      .filter((_, row) => (row % 2 === 0) === (column % 2 !== 0))
      .map((up) => ({ x: x + column * pitch, y: floor - up })),
  );

const GROUND: Rect = { x: 0, y: 265, w: MAP_WIDTH, h: 5 };

/**
 * Map 1, "Day". Eight levels 30 px apart over the ground, most of them short ledges. Both hives hang side by side at
 * the top centre over one long floor, so the two Queens start within a second's flight of each other; the snail runs
 * along the ground between nets at the walls, 225 px from the centre. Thin walls close the upper half of each edge:
 * the screen wraps only below them.
 */
const DAY = mirrored({
  id: 1,
  name: "Day",
  floor: GROUND,
  left: [
    { x: 0, y: 0, w: 3, h: 118 },
    ...level(30, [140, 154]),
    ...level(55, [3, 30], [85, 119]),
    ...level(85, [50, 64], [140, 154]),
    ...level(115, [2, 30], [85, 119], [175, 204]),
    ...level(145, [50, 154]),
    ...level(175, [2, 30], [175, 204]),
    ...level(205, [50, 70], [125, 154]),
    ...level(235, [2, 30], [90, 104]),
  ],
  centre: [
    middle(55, 175),
    middle(145, 225),
    middle(205, 225),
    middle(235, 175),
  ],
  hive: {
    wall: { x: 181, y: 0, w: 54, h: 55 },
    holes: comb(208, 55, 7, [14, 19, 24, 29, 34]),
    eggs: [
      { x: 226, y: 55 },
      { x: 233, y: 55 },
    ],
  },
  gatesLeft: [gate("speed", 102, 55), gate("warrior", 139, 205)],
  gatesCentre: [gate("warrior", 240, 145)],
  pilesLeft: [pile(97, 265), pile(59, 205), pile(189, 175), pile(16, 115)],
  pilesCentre: [pile(240, 235), pile(240, 205), hanging(240, 151)],
  snail: { y: 265, start: 240, goal: 15 },
  net: { x: 0, y: 246, w: 29, h: 19 },
  spawns: [
    { x: 184, y: 55 },
    { x: 208, y: 55 },
    { x: 178, y: 55 },
  ],
});

/**
 * Map 2, "Dusk". Two tall hive walls stand side by side in the middle of the screen with their holes far above the
 * ledge under them: the lower rows take a jump from that ledge, the upper ones a drop past the wall from the ledges
 * above it. Three blocks fill the gap between the walls. Walls close the edges between y 41 and 180.
 */
const DUSK = mirrored({
  id: 2,
  name: "Dusk",
  floor: GROUND,
  left: [
    { x: 0, y: 41, w: 3, h: 139 },
    ...level(2, [105, 130]),
    ...level(41, [0, 34]),
    ...level(55, [65, 89], [145, 174]),
    ...level(85, [0, 44], [110, 124]),
    ...level(115, [65, 90]),
    ...level(145, [35, 119], [175, 199]),
    ...level(175, [0, 14], [140, 154]),
    ...level(205, [0, 54], [115, 209]),
    ...level(235, [75, 94]),
  ],
  centre: [
    middle(55, 212),
    middle(75, 235, 15),
    middle(100, 235, 15),
    middle(125, 235, 10),
    middle(145, 220),
    middle(235, 230),
  ],
  hive: {
    wall: { x: 170, y: 60, w: 59, h: 79 },
    holes: comb(200, 145, 8, [29, 38, 48, 57, 67]),
    eggs: [
      { x: 181, y: 145 },
      { x: 193, y: 145 },
    ],
  },
  gatesLeft: [gate("warrior", 77, 115), gate("speed", 85, 235)],
  gatesCentre: [gate("warrior", 240, 235)],
  pilesLeft: [pile(22, 85), pile(40, 205), hanging(162, 211), pile(84, 265)],
  pilesCentre: [hanging(240, 0), pile(240, 55), hanging(240, 151)],
  snail: { y: 265, start: 240, goal: 15 },
  net: { x: 0, y: 246, w: 29, h: 19 },
  spawns: [
    { x: 187, y: 145 },
    { x: 180, y: 145 },
    { x: 194, y: 145 },
  ],
});

/**
 * Map 3, "Night". The hives are low rooms in the bottom corners, each under its own roof, and the snail walks a long
 * platform across the middle of the screen with its nets only 175 px from the centre. Two blocks stand on the centre
 * line below it. There are no walls: every level wraps. Nine piles, three of them hanging from the top of the screen.
 */
const NIGHT = mirrored({
  id: 3,
  name: "Night",
  floor: { x: 52, y: 147, w: 376, h: LEDGE },
  left: [
    ...level(33, [0, 60]),
    ...level(54, [85, 110]),
    ...level(85, [18, 60], [135, 161]),
    ...level(116, [84, 111], [187, 198]),
    ...level(178, [0, 25]),
    ...level(208, [0, 88], [156, 198]),
    ...level(240, [110, 136]),
  ],
  centre: [
    middle(54, 187),
    middle(95, 224),
    middle(180, 224, 38),
    middle(235, 225, 30),
    GROUND,
  ],
  hive: {
    wall: { x: 3, y: 215, w: 85, h: 50 },
    holes: comb(45, 265, 10, [14, 19, 24, 29, 34]),
    eggs: [
      { x: 12, y: 265 },
      { x: 20, y: 265 },
    ],
  },
  gatesLeft: [gate("speed", 42, 85), gate("warrior", 174, 208)],
  gatesCentre: [gate("warrior", 240, 95)],
  pilesLeft: [hanging(15, 0), hanging(42, 39), pile(125, 147)],
  pilesCentre: [hanging(240, 0), pile(240, 54), pile(240, 180)],
  snail: { y: 147, start: 240, goal: 65 },
  net: { x: 50, y: 128, w: 29, h: 19 },
  spawns: [
    { x: 80, y: 265 },
    { x: 45, y: 265 },
    { x: 66, y: 265 },
  ],
});

export const MAPS: Readonly<Record<MapId, MapDef>> = {
  1: DAY,
  2: DUSK,
  3: NIGHT,
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
  /** Per team, where each spare egg stands: a Queen respawns on the next one. */
  eggSpots: readonly [readonly Point[], readonly Point[]];
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
    eggSpots: [
      map.eggSpots[0].map(scalePoint),
      map.eggSpots[1].map(scalePoint),
    ],
  };
}

const ARENAS: Readonly<Record<MapId, Arena>> = {
  1: compile(DAY),
  2: compile(DUSK),
  3: compile(NIGHT),
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

/** The platform whose top a unit with its feet at (x, y) stands on, or -1 when it is in the air. */
export function standingOn(arena: Arena, x: number, y: number): number {
  return arena.solids.findIndex(
    (solid) => solid.y === y && x >= solid.x && x <= solid.x + solid.w,
  );
}
