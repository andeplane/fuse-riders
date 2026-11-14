import { generateLevel } from "./generate.js";
import { TEAM_MAPS, TEAM_MAP_IDS, type TeamArenaId } from "./team-maps.js";
import { SUB } from "./math.js";

/**
 * The arenas, as data in whole pixels on the map's field: 640×360 for a duel, bigger for the team arenas
 * (`team-maps.ts`). Every one is its own mirror image left to right, with
 * slot 0 starting on the left and slot 1 on the right, so neither rider is favoured.
 *
 * An axis that wraps has no edge: what leaves one side comes back on the other. A rect may therefore run past the
 * field's edge (`x + w > 640`, or `y + h > 360`) on a wrapping axis, which is how one wall or floor spans the seam;
 * whoever draws it draws the part past the edge again at the start.
 *
 * A goal belongs to the team whose colour it wears: the ball entering it scores for that team, whoever sent it. Each
 * rider's goal is on the far side of the arena from their spawn. Riders pass through goals untouched.
 */
export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}
export type Goal = { team: 0 | 1 } & (Rect | Circle);
export const isCircle = <T extends Rect | Circle>(
  shape: T,
): shape is T & Circle => "r" in shape;

export const MAP_IDS = [
  "gridlock",
  "downlink",
  "halo",
  "overflow",
  "firewall",
  "cornercase",
  "coredump",
  "bruteforce",
  "bouncerate",
  "portforward",
  "backdoor",
  "stacktrace",
] as const;
/** A hand-made arena: fixed data below. */
export type ArenaId = (typeof MAP_IDS)[number];
/**
 * The one map that is not written down: a level rolled from a seed by `generate.ts`. A checkpoint carries it as
 * `RANDOM_INDEX` and its seed, so it stays out of `MAP_IDS`, whose order is the wire format of the hand-made ones.
 */
export const RANDOM = "random";
export const RANDOM_INDEX = 255;
export { TEAM_MAP_IDS, TEAM_MAPS, type TeamArenaId };
/** A team arena's place in a checkpoint: `TEAM_INDEX` plus its place in `TEAM_MAP_IDS`, clear of the duel arenas'. */
export const TEAM_INDEX = 128;
export type MapId = ArenaId | TeamArenaId | typeof RANDOM;
export const isTeamMapId = (value: unknown): value is TeamArenaId =>
  typeof value === "string" &&
  (TEAM_MAP_IDS as readonly string[]).includes(value);
export const isMapId = (value: unknown): value is MapId =>
  typeof value === "string" &&
  (value === RANDOM ||
    (MAP_IDS as readonly string[]).includes(value) ||
    isTeamMapId(value));
/** A level's seed: any unsigned 32-bit integer. Every one of them rolls a playable level. */
export const MAX_SEED = 0xffff_ffff;
export const isSeed = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  !Object.is(value, -0) &&
  value >= 0 &&
  value <= MAX_SEED;

/**
 * Gadgets: things in an arena that act on the ball and only on the ball. Riders fly through every one of them, as
 * they do through goals and clouds, so a rider is only ever stopped by a solid or a hard bubble.
 *
 * A barrier is a wall the ball cannot pass while it is up:
 * - a `field` is a force field, usually over a goal's mouth. It throws the ball back hard, and every strike wears
 *   it down: after `hits` of them it is gone until the next point.
 * - a `gate` is a trapdoor. A ball that strikes it hard enough knocks it open for a few seconds; then it shuts.
 */
export type Barrier = Rect &
  ({ kind: "field"; hits: number } | { kind: "gate" });
/** A round bumper fixed in place: it throws the ball away from its centre, like a bubble that never pops. */
export type Bumper = Circle;
/**
 * A pair of portals of radius `r`: a ball flying into either end comes out of the other, at half its speed. `hue`
 * picks which of the two portal colours the pair wears.
 */
export interface Portal {
  a: Pt;
  b: Pt;
  r: number;
  hue: 0 | 1;
}

/**
 * A ledge is a one-way platform: riders and the ball come up through it from below and land on it from above. Only
 * its top edge is there; `h` is how thick it is drawn. A rider holding down drops through it.
 */
export type Ledge = Rect;
/**
 * A mover is a solid that travels: from where it is written down to `travel` pixels away and back, at a steady
 * speed, once every `period` micro-steps, waiting `dwell` micro-steps at each end. It travels along one axis, and
 * where it is depends on the world's step count alone, so it has no state of its own. Whatever stands or lies on it
 * is carried along.
 */
export interface Mover extends Rect {
  /** `travel`, `period` and `dwell` are whole even numbers (`gadgetFaults` checks), so every position is too. */
  travel: Pt;
  period: number;
  dwell: number;
}
/** How far along its travel a mover is on `step`, out of `of`: out, a wait, back, a wait. */
function along(mover: Mover, step: number): { at: number; of: number } {
  const half = mover.period / 2,
    of = half - mover.dwell,
    phase = ((step % mover.period) + mover.period) % mover.period,
    gone = phase < half ? phase : phase - half,
    moved = gone < of ? gone : of;
  return { at: phase < half ? moved : of - moved, of };
}
/** The field every duel arena is played on, in pixels. */
export const DUEL_W = 640,
  DUEL_H = 360;

export interface MapDef {
  id: MapId;
  name: string;
  /** The field's size in pixels. */
  w: number;
  h: number;
  wrapX: boolean;
  wrapY: boolean;
  solids: readonly Rect[];
  goals: readonly Goal[];
  /** While the ball's centre is inside one, the whole arena runs in slow motion, slower the nearer its centre. */
  clouds: readonly Circle[];
  /**
   * Where each rider stands (its centre) when a point starts, in the order of `World.riders`: even places are the
   * left side's, odd the right's. A duel arena has two; a team arena has one for every rider it holds.
   */
  spawns: readonly [Pt, Pt, ...Pt[]];
  /** Where the ball's centre waits out the countdown. */
  ballAnchor: Pt;
  /** The gadgets, in a fixed order: a barrier's state in the world is found by its place here. */
  barriers: readonly Barrier[];
  bumpers: readonly Bumper[];
  portals: readonly Portal[];
  ledges: readonly Ledge[];
  /** Movers are solids too: `boxesAt` has them where they are on a given step. */
  movers: readonly Mover[];
}
type Gadgets = "barriers" | "bumpers" | "portals" | "ledges" | "movers";
/** A map as it is written down: the gadgets it does not have are left out. */
export type MapSpec = Omit<MapDef, Gadgets | "w" | "h"> &
  Partial<Pick<MapDef, Gadgets | "w" | "h">>;
export const arena = (spec: MapSpec): MapDef => ({
  w: DUEL_W,
  h: DUEL_H,
  barriers: [],
  bumpers: [],
  portals: [],
  ledges: [],
  movers: [],
  ...spec,
});

const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  w,
  h,
});

/**
 * Gridlock wraps sideways. A floor and a ceiling, and one wall across the seam with a gap at mid height: the gap is
 * both goals back to back, so the ball leaving through the right side scores for slot 0 and through the left for
 * slot 1, while a rider just flies through and comes out on the other side.
 */
const gridlock: MapDef = arena({
  id: "gridlock",
  name: "Gridlock",
  wrapX: true,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 16),
    rect(0, 344, 640, 16),
    rect(628, 0, 24, 140),
    rect(628, 220, 24, 140),
    rect(250, 176, 140, 10),
    rect(80, 256, 100, 10),
    rect(460, 256, 100, 10),
  ],
  goals: [
    { team: 0, ...rect(628, 140, 12, 80) },
    { team: 1, ...rect(0, 140, 12, 80) },
  ],
  clouds: [
    { x: 64, y: 180, r: 44 },
    { x: 576, y: 180, r: 44 },
  ],
  spawns: [
    { x: 130, y: 335 },
    { x: 510, y: 335 },
  ],
  ballAnchor: { x: 320, y: 120 },
});

/**
 * Downlink wraps top to bottom. Solid side walls, and one slab across the seam with two shafts through it: a shaft
 * is a goal along its whole length, so the ball dropped into a pit or knocked up through the roof above it scores.
 */
const downlink: MapDef = arena({
  id: "downlink",
  name: "Downlink",
  wrapX: false,
  wrapY: true,
  solids: [
    rect(0, 0, 12, 360),
    rect(628, 0, 12, 360),
    rect(0, 344, 120, 32),
    rect(200, 344, 240, 32),
    rect(520, 344, 120, 32),
    rect(40, 270, 70, 10),
    rect(530, 270, 70, 10),
    rect(210, 190, 80, 10),
    rect(350, 190, 80, 10),
  ],
  goals: [
    { team: 0, ...rect(440, 344, 80, 16) },
    { team: 0, ...rect(440, 0, 80, 16) },
    { team: 1, ...rect(120, 344, 80, 16) },
    { team: 1, ...rect(120, 0, 80, 16) },
  ],
  clouds: [{ x: 320, y: 180, r: 56 }],
  spawns: [
    { x: 66, y: 335 },
    { x: 574, y: 335 },
  ],
  ballAnchor: { x: 320, y: 120 },
});

/**
 * Halo wraps both ways: no walls at all, four floating pads, the ball on a pedestal in the middle and a round goal
 * hanging high on each side.
 */
const halo: MapDef = arena({
  id: "halo",
  name: "Halo",
  wrapX: true,
  wrapY: true,
  solids: [
    rect(130, 250, 80, 10),
    rect(430, 250, 80, 10),
    rect(200, 120, 70, 10),
    rect(370, 120, 70, 10),
    rect(296, 200, 48, 12),
  ],
  goals: [
    { team: 0, x: 570, y: 70, r: 16 },
    { team: 1, x: 70, y: 70, r: 16 },
  ],
  clouds: [{ x: 320, y: 80, r: 60 }],
  spawns: [
    { x: 170, y: 241 },
    { x: 470, y: 241 },
  ],
  ballAnchor: { x: 320, y: 192 },
});

/**
 * Overflow wraps both ways. The seam wall has the goals in its gap, as in Gridlock, but the floor has two holes that
 * are nobody's goal: whatever drops through one comes back in at the top, over the high ledges. The wall and the
 * floor slab each cross a seam, so the wall's two ends and the floor and ceiling are one rect apiece.
 */
const overflow: MapDef = arena({
  id: "overflow",
  name: "Overflow",
  wrapX: true,
  wrapY: true,
  solids: [
    rect(628, 210, 24, 270),
    rect(490, 344, 300, 32),
    rect(220, 344, 200, 32),
    rect(70, 262, 90, 10),
    rect(480, 262, 90, 10),
    rect(190, 170, 90, 10),
    rect(360, 170, 90, 10),
  ],
  goals: [
    { team: 0, ...rect(628, 120, 12, 90) },
    { team: 1, ...rect(0, 120, 12, 90) },
  ],
  clouds: [
    { x: 64, y: 165, r: 44 },
    { x: 576, y: 165, r: 44 },
  ],
  spawns: [
    { x: 115, y: 253 },
    { x: 525, y: 253 },
  ],
  ballAnchor: { x: 320, y: 110 },
});

/**
 * Firewall wraps both ways and has no floor or ceiling at all: whatever is not standing on a pad falls for ever,
 * out of the bottom and in at the top. The goals are the gaps in the seam wall, each behind a short wall of its own
 * that the ball has to be sent over or under. The ball starts in the open and lands on the high pad from above.
 */
const firewall: MapDef = arena({
  id: "firewall",
  name: "Firewall",
  wrapX: true,
  wrapY: true,
  solids: [
    rect(628, 240, 24, 240),
    rect(62, 130, 12, 100),
    rect(566, 130, 12, 100),
    rect(200, 280, 60, 10),
    rect(380, 280, 60, 10),
    rect(290, 90, 60, 10),
  ],
  goals: [
    { team: 0, ...rect(628, 120, 12, 120) },
    { team: 1, ...rect(0, 120, 12, 120) },
  ],
  clouds: [
    { x: 34, y: 180, r: 34 },
    { x: 606, y: 180, r: 34 },
  ],
  spawns: [
    { x: 230, y: 271 },
    { x: 410, y: 271 },
  ],
  ballAnchor: { x: 320, y: 200 },
});

/**
 * Corner Case wraps top to bottom. The goals are the four corners: a pocket between each side wall and the end of
 * the floor, which is the same shaft as the pocket in the roof above it. A kerb stands at the edge of every pocket
 * (and hangs from the roof beside it), so a ball rolled along the floor stops short and has to be lifted in. The
 * ball starts on the anvil in the middle.
 */
const cornercase: MapDef = arena({
  id: "cornercase",
  name: "Corner Case",
  wrapX: false,
  wrapY: true,
  solids: [
    rect(0, 0, 12, 360),
    rect(628, 0, 12, 360),
    rect(60, 344, 520, 32),
    rect(60, 322, 16, 76),
    rect(564, 322, 16, 76),
    rect(264, 160, 112, 10),
    rect(312, 170, 16, 70),
  ],
  goals: [
    { team: 0, ...rect(580, 344, 48, 16) },
    { team: 0, ...rect(580, 0, 48, 16) },
    { team: 1, ...rect(12, 344, 48, 16) },
    { team: 1, ...rect(12, 0, 48, 16) },
  ],
  clouds: [
    { x: 90, y: 296, r: 40 },
    { x: 550, y: 296, r: 40 },
  ],
  spawns: [
    { x: 160, y: 335 },
    { x: 480, y: 335 },
  ],
  ballAnchor: { x: 320, y: 120 },
});

/**
 * Core Dump wraps top to bottom. Both goals are pits side by side in the middle of the floor, with a post between
 * them, and each is the same shaft as the opening in the roof above it. A rider's pit is the far one, so a ball on
 * their own half of the floor has to go over the near pit, which is the other colour's. A roof hangs over both
 * pits; the ball starts on it.
 */
const coredump: MapDef = arena({
  id: "coredump",
  name: "Core Dump",
  wrapX: false,
  wrapY: true,
  solids: [
    rect(0, 0, 12, 360),
    rect(628, 0, 12, 360),
    rect(0, 344, 260, 32),
    rect(380, 344, 260, 32),
    rect(314, 316, 12, 88),
    rect(240, 170, 160, 10),
    rect(60, 250, 90, 10),
    rect(490, 250, 90, 10),
  ],
  goals: [
    { team: 0, ...rect(326, 344, 54, 16) },
    { team: 0, ...rect(326, 0, 54, 16) },
    { team: 1, ...rect(260, 344, 54, 16) },
    { team: 1, ...rect(260, 0, 54, 16) },
  ],
  clouds: [{ x: 320, y: 290, r: 56 }],
  spawns: [
    { x: 150, y: 335 },
    { x: 490, y: 335 },
  ],
  ballAnchor: { x: 320, y: 130 },
});

/**
 * Brute Force wraps sideways. The goals are the gap in the seam wall, as in Gridlock, but each has a force field
 * across its mouth: the ball is thrown back off it, and the third strike breaks it for the rest of the point. A
 * pillar splits the floor in two, and the ball starts on the bridge over it.
 */
const bruteforce: MapDef = arena({
  id: "bruteforce",
  name: "Brute Force",
  wrapX: true,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 16),
    rect(0, 344, 640, 16),
    rect(628, 0, 24, 150),
    rect(628, 250, 24, 110),
    rect(314, 270, 12, 74),
    rect(270, 160, 100, 10),
    rect(120, 256, 90, 10),
    rect(430, 256, 90, 10),
  ],
  goals: [
    { team: 0, ...rect(628, 150, 12, 100) },
    { team: 1, ...rect(0, 150, 12, 100) },
  ],
  clouds: [
    { x: 70, y: 200, r: 40 },
    { x: 570, y: 200, r: 40 },
  ],
  spawns: [
    { x: 165, y: 335 },
    { x: 475, y: 335 },
  ],
  ballAnchor: { x: 320, y: 120 },
  barriers: [
    { kind: "field", hits: 3, ...rect(616, 150, 8, 100) },
    { kind: "field", hits: 3, ...rect(16, 150, 8, 100) },
  ],
});

/**
 * Bounce Rate is a closed box: nothing wraps. Each goal is an alcove in a side wall with a bumper standing guard
 * in front of it, so a straight shot comes back and the ball has to be slipped in over or under. Three more
 * bumpers hang about the middle, and the ball starts on a perch between them.
 */
const bouncerate: MapDef = arena({
  id: "bouncerate",
  name: "Bounce Rate",
  wrapX: false,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 12),
    rect(0, 348, 640, 12),
    rect(0, 12, 24, 198),
    rect(0, 210, 6, 80),
    rect(0, 290, 24, 58),
    rect(616, 12, 24, 198),
    rect(634, 210, 6, 80),
    rect(616, 290, 24, 58),
    rect(280, 150, 80, 10),
    rect(110, 296, 70, 10),
    rect(460, 296, 70, 10),
  ],
  goals: [
    { team: 0, ...rect(616, 210, 18, 80) },
    { team: 1, ...rect(6, 210, 18, 80) },
  ],
  clouds: [
    { x: 62, y: 250, r: 44 },
    { x: 578, y: 250, r: 44 },
  ],
  spawns: [
    { x: 210, y: 339 },
    { x: 430, y: 339 },
  ],
  ballAnchor: { x: 320, y: 120 },
  bumpers: [
    { x: 62, y: 250, r: 12 },
    { x: 578, y: 250, r: 12 },
    { x: 236, y: 104, r: 14 },
    { x: 404, y: 104, r: 14 },
    { x: 320, y: 236, r: 14 },
  ],
});

/**
 * Port Forward is a closed box with two pits in its floor, each under a roof of its own; a rider's pit is the far
 * one. Low in each corner is a portal whose other end hangs high over the far side: a ball knocked back into a
 * rider's own corner comes out above the roof of the pit it scores in. Only the ball goes through.
 */
const portforward: MapDef = arena({
  id: "portforward",
  name: "Port Forward",
  wrapX: false,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 12),
    rect(0, 12, 12, 348),
    rect(628, 12, 12, 348),
    rect(12, 340, 88, 20),
    rect(160, 340, 320, 20),
    rect(540, 340, 88, 20),
    // The pits have a bottom, so a rider who drops into one stands in it and can jump out.
    rect(100, 356, 60, 4),
    rect(480, 356, 60, 4),
    rect(90, 262, 80, 10),
    rect(470, 262, 80, 10),
    rect(270, 180, 100, 10),
  ],
  goals: [
    { team: 0, ...rect(480, 340, 60, 16) },
    { team: 1, ...rect(100, 340, 60, 16) },
  ],
  clouds: [
    { x: 130, y: 306, r: 36 },
    { x: 510, y: 306, r: 36 },
  ],
  spawns: [
    { x: 220, y: 331 },
    { x: 420, y: 331 },
  ],
  ballAnchor: { x: 320, y: 140 },
  portals: [
    { hue: 0, r: 14, a: { x: 36, y: 326 }, b: { x: 530, y: 90 } },
    { hue: 1, r: 14, a: { x: 604, y: 326 }, b: { x: 110, y: 90 } },
  ],
});

/**
 * Backdoor wraps sideways with nothing across the seam, so the two ends of the floor are one back room, walled
 * off from the front by a pillar on each side. Both pits are in there, each shut by a trapdoor: a ball dropped or
 * lifted onto one knocks it open for three seconds, and has to come down again before it shuts. A ball rolled
 * onto a trapdoor just lies on it.
 */
const backdoor: MapDef = arena({
  id: "backdoor",
  name: "Backdoor",
  wrapX: true,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 12),
    rect(120, 330, 400, 30),
    rect(580, 330, 120, 30),
    rect(60, 356, 60, 4),
    rect(520, 356, 60, 4),
    rect(150, 230, 12, 100),
    rect(478, 230, 12, 100),
    rect(200, 256, 80, 10),
    rect(360, 256, 80, 10),
    rect(280, 160, 80, 10),
    rect(600, 200, 80, 10),
  ],
  goals: [
    { team: 0, ...rect(520, 336, 60, 20) },
    { team: 1, ...rect(60, 336, 60, 20) },
  ],
  clouds: [
    { x: 90, y: 290, r: 40 },
    { x: 550, y: 290, r: 40 },
  ],
  spawns: [
    { x: 220, y: 321 },
    { x: 420, y: 321 },
  ],
  ballAnchor: { x: 320, y: 130 },
  barriers: [
    { kind: "gate", ...rect(520, 330, 60, 6) },
    { kind: "gate", ...rect(60, 330, 60, 6) },
  ],
});

/**
 * Stack Trace is a closed box. Each goal is an alcove high in a side wall, and beside each wall a lift goes up and
 * down: it waits a second at the top of its ride, level with the alcove's sill, so a ball lying on it can be rolled in. Up the
 * middle is a stack of ledges that riders and the ball come up through and land on; the ball starts on the top one.
 */
const stacktrace: MapDef = arena({
  id: "stacktrace",
  name: "Stack Trace",
  wrapX: false,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 12),
    rect(0, 348, 640, 12),
    rect(0, 12, 24, 78),
    rect(0, 90, 6, 80),
    rect(0, 170, 24, 178),
    rect(616, 12, 24, 78),
    rect(634, 90, 6, 80),
    rect(616, 170, 24, 178),
  ],
  goals: [
    { team: 0, ...rect(616, 90, 18, 80) },
    { team: 1, ...rect(6, 90, 18, 80) },
  ],
  clouds: [
    { x: 66, y: 130, r: 40 },
    { x: 574, y: 130, r: 40 },
  ],
  spawns: [
    { x: 200, y: 339 },
    { x: 440, y: 339 },
  ],
  ballAnchor: { x: 320, y: 110 },
  ledges: [
    rect(270, 140, 100, 6),
    rect(240, 210, 160, 6),
    rect(270, 280, 100, 6),
    rect(130, 244, 80, 6),
    rect(430, 244, 80, 6),
  ],
  movers: [
    {
      ...rect(24, 310, 64, 10),
      travel: { x: 0, y: -140 },
      period: 840,
      dwell: 120,
    },
    {
      ...rect(552, 310, 64, 10),
      travel: { x: 0, y: -140 },
      period: 840,
      dwell: 120,
    },
  ],
});

export const MAPS: Readonly<Record<ArenaId, MapDef>> = {
  gridlock,
  downlink,
  halo,
  overflow,
  firewall,
  cornercase,
  coredump,
  bruteforce,
  bouncerate,
  portforward,
  backdoor,
  stacktrace,
};

/**
 * Rolled levels, by seed. Rolling one is a pure function of its seed, so this is a memo and not state: the newest
 * few are kept and the oldest dropped, and a seed that was dropped rolls to the same level again.
 */
const ROLLED_KEPT = 8;
const rolled = new Map<number, MapDef>();
function rolledLevel(seed: number): MapDef {
  const known = rolled.get(seed);
  if (known) return known;
  const level = generateLevel(seed);
  if (rolled.size >= ROLLED_KEPT)
    for (const oldest of rolled.keys()) {
      rolled.delete(oldest);
      break;
    }
  rolled.set(seed, level);
  return level;
}

/** The arena `id` names. Only the random one reads `seed`: a seed that is not one rolls as seed 0. */
export const mapOf = (id: MapId, seed = 0): MapDef =>
  id === RANDOM
    ? rolledLevel(isSeed(seed) ? seed : 0)
    : isTeamMapId(id)
      ? TEAM_MAPS[id]
      : MAPS[id];
/** The most riders a side the arena has marks for. */
export const teamSizeOf = (map: MapDef): number => map.spawns.length >> 1;
/** The arena a world or a view of one is played in. */
export const arenaOf = (at: { mapId: MapId; seed: number }): MapDef =>
  mapOf(at.mapId, at.seed);

/** A solid as the collision code wants it: centre and half extents, in sub-units. */
export interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}
export const boxOf = (rect: Rect): Box => ({
  // Every rect has even sides, so the centre is a whole number of sub-units.
  cx: (rect.x * SUB * 2 + rect.w * SUB) / 2,
  cy: (rect.y * SUB * 2 + rect.h * SUB) / 2,
  hw: (rect.w * SUB) / 2,
  hh: (rect.h * SUB) / 2,
});
/** Derived once per arena and dropped with it: a memo keyed by the arena itself, so it holds nothing alive. */
const BOXES = new WeakMap<MapDef, readonly Box[]>(),
  BARRIER_BOXES = new WeakMap<MapDef, readonly Box[]>(),
  LEDGE_BOXES = new WeakMap<MapDef, readonly Box[]>();
/** The map's solids in sub-units. */
export function boxesOf(map: MapDef): readonly Box[] {
  let boxes = BOXES.get(map);
  if (!boxes) BOXES.set(map, (boxes = map.solids.map(boxOf)));
  return boxes;
}
/** The map's barriers in sub-units, in the order of `MapDef.barriers`. */
export function barrierBoxesOf(map: MapDef): readonly Box[] {
  let boxes = BARRIER_BOXES.get(map);
  if (!boxes) BARRIER_BOXES.set(map, (boxes = map.barriers.map(boxOf)));
  return boxes;
}
/** The map's ledges in sub-units: only the top face of each box is there. */
export function ledgeBoxesOf(map: MapDef): readonly Box[] {
  let boxes = LEDGE_BOXES.get(map);
  if (!boxes) LEDGE_BOXES.set(map, (boxes = map.ledges.map(boxOf)));
  return boxes;
}

/**
 * How far a mover is from where it is written down on micro-step `step`, in sub-units: out along `travel`, a wait,
 * and back. Whole numbers in, whole numbers out, and a mirrored mover is mirrored.
 */
export function moverOffset(mover: Mover, step: number): Pt {
  const { at, of } = along(mover, step),
    // Truncated toward zero either way, so a travel of −n is the mirror image of a travel of n.
    out = (pixels: number) => Math.trunc((pixels * SUB * at) / of) + 0;
  return { x: out(mover.travel.x), y: out(mover.travel.y) };
}
/**
 * Where a mover's top left corner is on step `step`, in pixels, for whoever draws it: `step` may be a fraction
 * between two steps, and the answer is one too. The rules never read this.
 */
export function moverPlace(mover: Mover, step: number): Pt {
  const { at, of } = along(mover, step);
  return {
    x: mover.x + (mover.travel.x * at) / of,
    y: mover.y + (mover.travel.y * at) / of,
  };
}
/** A mover as a box where it is on micro-step `step`. */
export function moverBoxAt(mover: Mover, step: number): Box {
  const box = boxOf(mover),
    off = moverOffset(mover, step);
  return { ...box, cx: box.cx + off.x, cy: box.cy + off.y };
}
/**
 * Where the movers are comes round again every so often, so it is worked out once per place in that round and kept:
 * a memo keyed by the arena, which holds nothing alive. A map whose movers keep different periods has no short round
 * and is worked out afresh each time.
 */
interface Round {
  period: number;
  movers: (readonly Box[] | undefined)[];
  all: (readonly Box[] | undefined)[];
}
const ROUNDS = new WeakMap<MapDef, Round>();
function roundOf(map: MapDef): Round {
  let round = ROUNDS.get(map);
  if (!round) {
    const period = map.movers[0]?.period ?? 0,
      shared =
        Number.isInteger(period) &&
        period > 0 &&
        period <= 3600 &&
        map.movers.every((mover) => mover.period === period);
    ROUNDS.set(
      map,
      (round = { period: shared ? period : 0, movers: [], all: [] }),
    );
  }
  return round;
}
const place = (step: number, period: number): number =>
  ((step % period) + period) % period;
/** The map's movers as boxes where they are on micro-step `step`, in the order of `MapDef.movers`. */
export function moverBoxesAt(map: MapDef, step: number): readonly Box[] {
  const round = roundOf(map),
    work = () => map.movers.map((mover) => moverBoxAt(mover, step));
  if (!round.period) return work();
  return (round.movers[place(step, round.period)] ??= work());
}
/**
 * Everything solid on micro-step `step`: the map's solids, then its movers where they are then. With no movers it
 * is the solids themselves.
 */
export function boxesAt(map: MapDef, step: number): readonly Box[] {
  if (map.movers.length === 0) return boxesOf(map);
  const round = roundOf(map),
    work = () => [...boxesOf(map), ...moverBoxesAt(map, step)];
  if (!round.period) return work();
  return (round.all[place(step, round.period)] ??= work());
}
