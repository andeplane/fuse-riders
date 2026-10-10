// The temple: the one authored map of the sky overhaul, 4800 × 2700 logical pixels, painted from shapes onto a
// `Grid`. Its outline borrows the huge temple stage of Super Smash Bros. Melee: a terrace on each side, a central
// shrine with a tunnel through it, the main hall, a cave hollowed out underneath, a stepped ramp down the right, a
// tapering underbelly and a few floating islets, with open sky all round. Preview: docs/images/temple-map.png
// (`pnpm exec tsx games/fuse-bombers/preview/map-preview.ts`).

import { createGrid, fillPolygon, type Grid, type Paint } from "./grid.js";
import { hashSeed, int, type RngHolder } from "./rng.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in world pixels, `x1` and `y1` exclusive. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A polygon (flat x, y pairs) and what it paints; later shapes paint over earlier ones. */
export interface MapShape {
  readonly points: readonly number[];
  readonly paint?: Paint;
}

export interface MapDef {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly shapes: readonly MapShape[];
  /** Spawn points in open air; `spawnOrder` picks a spread set of them. */
  readonly spawnAnchors: readonly Point[];
  /** Rectangles of open air where gates and crates may float. */
  readonly skyZones: readonly Rect[];
}

/** Paints a map's shapes onto a fresh grid (version 0). */
export function buildMapGrid(map: MapDef): Grid {
  const grid = createGrid(map.width, map.height, map.cell);
  for (const shape of map.shapes) fillPolygon(grid, shape.points, shape.paint);
  return grid;
}

const poly = (points: readonly number[], paint?: Paint): MapShape => ({
  points,
  paint,
});
const rect = (x0: number, y0: number, x1: number, y1: number, paint?: Paint) =>
  poly([x0, y0, x1, y0, x1, y1, x0, y1], paint);
/** A floating islet's outline in units of its width: a flat top tapering to a point below. */
// prettier-ignore
const ISLET = [-0.5, 0,  0.5, 0,  0.42, 0.13,  0.2, 0.27,  0.04, 0.42,  -0.06, 0.38,  -0.24, 0.25,  -0.43, 0.12];
const islet = (x: number, top: number, w: number): MapShape =>
  poly(ISLET.map((v, i) => (i % 2 === 0 ? x : top) + v * w));

/** Named places, for tests and later for bots and the camera. */
export const TEMPLE_LANDMARKS = {
  /** Middle of the tunnel through the shrine. */
  tunnel: { x: 2400, y: 1010 },
  /** Middle of the cave under the main hall, and just outside its left mouth and its lower-right exit. */
  cave: { x: 1650, y: 1880 },
  caveMouth: { x: 820, y: 1880 },
  caveExit: { x: 2900, y: 2380 },
  /** The bays under the terraces: the left one under the skylight, the right one below the tunnel exit. */
  leftBay: { x: 1150, y: 1210 },
  rightBay: { x: 3200, y: 1210 },
} as const satisfies Record<string, Point>;

// prettier-ignore
const TEMPLE_SHAPES: readonly MapShape[] = [
  // The main mass: the hall floor, the stepped ramp down the right (a wing with sky under it) and the underbelly
  // tapering to its keel.
  poly([
    700, 1300,  3800, 1300,  3800, 1450,  3900, 1450,  3900, 1600,  4000, 1600,  4000, 1750,  4100, 1750,
    4100, 1900,  4200, 1900,  4200, 2050,  4300, 2050,  4300, 2200,  4420, 2200,  4420, 2250,  4330, 2290,
    3700, 1820,  3300, 1950,  2900, 2180,  2500, 2370,  2150, 2400,  1800, 2370,  1400, 2260,  1060, 2090,
    980, 1660,  760, 1620,  700, 1580,
  ]),
  // The cave: a long chamber under the hall, open to the left, with a passage down to the lower right, and two
  // stalactites.
  poly([
    900, 1730,  1150, 1700,  1700, 1705,  2200, 1720,  2400, 1790,  2450, 1930,  2380, 2040,  1700, 2060,
    1150, 2050,  900, 2030,
  ], "air"),
  poly([2320, 1900,  2450, 1870,  2920, 2260,  2780, 2330,  2300, 2020], "air"),
  poly([1330, 1700,  1450, 1700,  1390, 1800]),
  poly([1880, 1700,  2000, 1700,  1940, 1790]),

  // The terraces: each is two slabs with a skylight between them, resting on a column either side of it, so every
  // bay under a terrace opens to the sky (left: the open end, the skylight, the shaft by the shrine; right: the
  // tunnel, the skylight, the stairs). Square pillars stand on the left one.
  poly([550, 1000,  1080, 1000,  1080, 1120,  620, 1120,  550, 1060]),
  rect(1220, 1000, 1750, 1120),
  rect(760, 880, 860, 1000, "hard"),
  rect(1440, 880, 1540, 1000, "hard"),
  rect(1000, 1120, 1060, 1300, "hard"),
  rect(1240, 1120, 1300, 1300, "hard"),
  rect(3050, 1000, 3540, 1120),
  poly([3680, 1000,  4250, 1000,  4250, 1060,  4180, 1120,  3680, 1120]),
  rect(3460, 1120, 3520, 1300, "hard"),
  rect(3700, 1120, 3760, 1300, "hard"),

  // The shrine: a block on the hall with a peaked roof and an arched tunnel straight through it. Its legs and a keel
  // under its middle stay through any bombing.
  rect(1960, 780, 2840, 1300),
  poly([1870, 800,  2400, 610,  2930, 800,  2930, 820,  1870, 820]),
  poly([1870, 1080,  1870, 960,  2100, 945,  2400, 930,  2700, 945,  2930, 960,  2930, 1080], "air"),
  rect(1960, 1080, 2020, 1300, "hard"),
  rect(2780, 1080, 2840, 1300, "hard"),
  rect(2370, 1080, 2430, 1680, "hard"),
  // The thin bridge from the shrine, above the tunnel mouth, to a gatehouse on the right terrace.
  rect(2840, 900, 3050, 922),
  rect(3050, 900, 3130, 1000, "hard"),

  // Floating islets for cover.
  islet(650, 520, 260),
  islet(2400, 400, 220),
  islet(4150, 520, 260),
  islet(470, 1850, 180),
  islet(4380, 1300, 160),
  islet(700, 2260, 200),
];

export const TEMPLE_MAP: MapDef = {
  name: "temple",
  width: 4800,
  height: 2700,
  cell: 4,
  shapes: TEMPLE_SHAPES,
  spawnAnchors: [
    { x: 420, y: 360 }, // 0 top left
    { x: 1350, y: 600 }, // 1 above the left terrace
    { x: 2400, y: 220 }, // 2 top centre
    { x: 3450, y: 600 }, // 3 above the right terrace
    { x: 4380, y: 360 }, // 4 top right
    { x: 330, y: 1300 }, // 5 left flank
    { x: 4520, y: 1580 }, // 6 right flank
    { x: 380, y: 2480 }, // 7 bottom left
    { x: 4420, y: 2500 }, // 8 bottom right
    { x: 1550, y: 2560 }, // 9 under the left
    { x: 3250, y: 2560 }, // 10 under the right
    { x: 2400, y: 2580 }, // 11 under the keel
  ],
  skyZones: [
    { x0: 200, y0: 130, x1: 4600, y1: 330 }, // high sky
    { x0: 900, y0: 420, x1: 1800, y1: 800 }, // over the left terrace
    { x0: 3000, y0: 420, x1: 3900, y1: 840 }, // over the right terrace
    { x0: 120, y0: 900, x1: 480, y1: 1700 }, // left flank
    { x0: 4480, y0: 1400, x1: 4680, y1: 2100 }, // right flank
    { x0: 3250, y0: 2080, x1: 3900, y1: 2380 }, // under the right wing
    { x0: 900, y0: 2460, x1: 4200, y1: 2620 }, // under the keel
  ],
};

export const spawnAnchors = TEMPLE_MAP.spawnAnchors;
export const skyZones = TEMPLE_MAP.skyZones;

/** The temple painted onto a fresh grid. */
export function buildTempleGrid(): Grid {
  return buildMapGrid(TEMPLE_MAP);
}

/**
 * Spread sets of `spawnAnchors` indices per player count, each symmetric about the shrine. Anchors come in mirrored
 * pairs (0/4, 1/3, 5/6, 7/8, 9/10) plus the top centre (2) and under the keel (11).
 */
// prettier-ignore
const SPAWN_SETS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [[5, 6], [0, 4], [7, 8], [1, 3], [9, 10]],
  3: [[0, 4, 11], [7, 8, 2], [5, 6, 2], [5, 6, 11]],
  4: [[0, 4, 7, 8], [5, 6, 2, 11], [1, 3, 9, 10]],
  5: [[0, 4, 7, 8, 2], [0, 4, 7, 8, 11], [5, 6, 1, 3, 11]],
  6: [[0, 4, 5, 6, 7, 8], [0, 2, 4, 7, 11, 8], [1, 3, 5, 6, 9, 10]],
};

/**
 * Spawn points for `count` players (2–6), seat by seat: a spread, symmetric set of anchors chosen by `seed`, dealt
 * to the seats in a seeded order. Deterministic. Throws `RangeError` for other counts.
 */
export function spawnOrder(count: number, seed: number): Point[] {
  const sets = SPAWN_SETS[count];
  if (!sets) throw new RangeError(`no spawn sets for ${count} players`);
  const rng: RngHolder = { rng: hashSeed(seed, 0x5eed) };
  const chosen = [...(sets[int(rng, 0, sets.length - 1)] ?? [])];
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [chosen[i], chosen[j]] = [chosen[j] ?? 0, chosen[i] ?? 0];
  }
  return chosen.map((i) => spawnAnchors[i] ?? { x: 0, y: 0 });
}
