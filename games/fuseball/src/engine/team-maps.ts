import type { MapDef, Pt, Rect } from "./maps.js";

/**
 * The team arenas: 2v2 and 3v3 are played here and nowhere else. They are bigger than a duel's field (960×540
 * against 640×360, so a little over twice the room) and each has marks for three riders a side; a 2v2 uses the first
 * two. Like the duel arenas each is its own mirror image left to right, and the left side scores on the right.
 *
 * Their order is their place in a checkpoint (after `TEAM_INDEX`, see `maps.ts`): add new ones at the end.
 */
export const TEAM_MAP_IDS = [
  "mainframe",
  "backbone",
  "multiplex",
  "uplink",
] as const;
export type TeamArenaId = (typeof TEAM_MAP_IDS)[number];

export const TEAM_W = 960,
  TEAM_H = 540;

const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  w,
  h,
});
/** Each rect and its mirror image. */
const both = (...rects: Rect[]): Rect[] =>
  rects.flatMap((r) => [r, { ...r, x: TEAM_W - r.x - r.w }]);
/** The marks for three riders a side, from the left side's: the sides take turns, each mark facing its mirror. */
const marks = (
  y: number,
  ...xs: [number, number, number]
): MapDef["spawns"] => {
  const [a, b, c] = xs.map((x): [Pt, Pt] => [
    { x, y },
    { x: TEAM_W - x, y },
  ]) as [[Pt, Pt], [Pt, Pt], [Pt, Pt]];
  return [...a, ...b, ...c];
};
const team = (
  spec: Omit<
    MapDef,
    "w" | "h" | "barriers" | "bumpers" | "portals" | "ledges" | "movers"
  > &
    Partial<Pick<MapDef, "barriers" | "bumpers" | "portals">>,
): MapDef => ({
  w: TEAM_W,
  h: TEAM_H,
  barriers: [],
  bumpers: [],
  portals: [],
  ledges: [],
  movers: [],
  ...spec,
});

/**
 * Mainframe is the stadium: a closed hall with a goal let into each end wall at mid height, a pillar on the centre
 * spot and ledges stepping up towards each goal. A cloud hangs in front of each mouth.
 */
const mainframe = team({
  id: "mainframe",
  name: "Mainframe",
  wrapX: false,
  wrapY: false,
  solids: [
    rect(0, 0, 960, 12),
    rect(0, 520, 960, 20),
    ...both(
      rect(0, 12, 24, 208),
      rect(0, 220, 4, 120),
      rect(0, 340, 24, 180),
      rect(120, 420, 120, 10),
      rect(250, 320, 110, 10),
      rect(90, 170, 100, 10),
      rect(330, 130, 90, 10),
    ),
    rect(410, 230, 140, 10),
    rect(474, 440, 12, 80),
  ],
  goals: [
    { team: 0, ...rect(936, 220, 20, 120) },
    { team: 1, ...rect(4, 220, 20, 120) },
  ],
  clouds: [
    { x: 130, y: 280, r: 50 },
    { x: 830, y: 280, r: 50 },
  ],
  spawns: marks(511, 300, 220, 140),
  ballAnchor: { x: 480, y: 150 },
});

/**
 * Backbone wraps sideways. One wall stands across the seam with a tall gap at mid height, and the gap is both goals
 * back to back, as in Gridlock; here a post stands in front of each mouth, so a straight shot along the middle
 * comes back and the way in is over or under it.
 */
const backbone = team({
  id: "backbone",
  name: "Backbone",
  wrapX: true,
  wrapY: false,
  solids: [
    rect(0, 0, 960, 16),
    rect(0, 524, 960, 16),
    rect(940, 0, 40, 200),
    rect(940, 340, 40, 200),
    ...both(
      rect(72, 236, 12, 68),
      rect(110, 410, 130, 10),
      rect(260, 300, 120, 10),
      rect(130, 150, 110, 10),
    ),
    rect(400, 200, 160, 10),
    rect(430, 420, 100, 10),
  ],
  goals: [
    { team: 0, ...rect(940, 200, 20, 140) },
    { team: 1, ...rect(0, 200, 20, 140) },
  ],
  clouds: [
    { x: 150, y: 270, r: 46 },
    { x: 810, y: 270, r: 46 },
  ],
  spawns: marks(515, 330, 250, 170),
  ballAnchor: { x: 480, y: 140 },
});

/**
 * Multiplex is a closed box on four levels with a pit in the floor near each end, each under a roof of its own: the
 * ball goes in from the side, under the roof, or is dropped through the gap between the roof and the wall.
 */
const multiplex = team({
  id: "multiplex",
  name: "Multiplex",
  wrapX: false,
  wrapY: false,
  solids: [
    rect(0, 0, 960, 12),
    ...both(
      rect(0, 12, 12, 528),
      rect(12, 516, 128, 24),
      // The pits have a bottom, so a rider who drops into one stands in it and can jump out.
      rect(140, 536, 90, 4),
      rect(150, 440, 110, 10),
      rect(300, 410, 100, 10),
      rect(190, 300, 90, 10),
      rect(60, 220, 110, 10),
      rect(330, 200, 80, 10),
    ),
    rect(230, 516, 500, 24),
    rect(420, 320, 120, 10),
    rect(474, 430, 12, 86),
  ],
  goals: [
    { team: 0, ...rect(730, 516, 90, 20) },
    { team: 1, ...rect(140, 516, 90, 20) },
  ],
  clouds: [
    { x: 185, y: 480, r: 40 },
    { x: 775, y: 480, r: 40 },
  ],
  spawns: marks(507, 420, 350, 280),
  ballAnchor: { x: 480, y: 150 },
});

/**
 * Uplink wraps top to bottom. Solid side walls, and one slab across the seam with two shafts through it: a shaft is
 * a goal along its whole length, so the ball dropped into a pit or knocked up through the roof above it scores.
 * The big cloud in the middle is where most of the play slows down.
 */
const uplink = team({
  id: "uplink",
  name: "Uplink",
  wrapX: false,
  wrapY: true,
  solids: [
    ...both(
      rect(0, 0, 12, 540),
      rect(0, 516, 180, 48),
      rect(60, 400, 100, 10),
      rect(310, 300, 110, 10),
      rect(150, 220, 100, 10),
      rect(40, 120, 80, 10),
    ),
    rect(290, 516, 380, 48),
    rect(420, 400, 120, 10),
    rect(410, 170, 140, 10),
  ],
  goals: [
    { team: 0, ...rect(670, 516, 110, 24) },
    { team: 0, ...rect(670, 0, 110, 24) },
    { team: 1, ...rect(180, 516, 110, 24) },
    { team: 1, ...rect(180, 0, 110, 24) },
  ],
  clouds: [{ x: 480, y: 290, r: 60 }],
  spawns: marks(507, 440, 390, 340),
  ballAnchor: { x: 480, y: 120 },
});

export const TEAM_MAPS: Readonly<Record<TeamArenaId, MapDef>> = {
  mainframe,
  backbone,
  multiplex,
  uplink,
};
