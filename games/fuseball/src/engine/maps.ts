import { SUB } from "./math.js";

/**
 * The arenas, as data in whole pixels on the 640×360 field. Every one is its own mirror image left to right, with
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
  "quadcore",
  "bitstream",
  "memoryleak",
] as const;
export type MapId = (typeof MAP_IDS)[number];
export const isMapId = (value: unknown): value is MapId =>
  typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);

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
 * Liquids, which like every gadget act on the ball alone and keep no state. `hue` is the team colour one wears, for
 * the look only: neither side owns it.
 *
 * Goo is thick: a ball whose centre is in it loses a share of its speed every step, so it sinks slowly and a kick
 * barely moves it. A pool of it across a seam is drawn again on the far side, like a solid.
 */
export type Goo = Rect & { hue: 0 | 1 };
/** A jet of liquid running straight up: a ball whose centre is in it is slowed and pushed upwards, so it rides on top. */
export type Stream = Rect & { hue: 0 | 1 };

export interface MapDef {
  id: MapId;
  name: string;
  wrapX: boolean;
  wrapY: boolean;
  solids: readonly Rect[];
  goals: readonly Goal[];
  /** While the ball's centre is inside one, the whole arena runs in slow motion, slower the nearer its centre. */
  clouds: readonly Circle[];
  /** Where each slot's rider stands (its centre) when a point starts. */
  spawns: readonly [Pt, Pt];
  /** Where the ball's centre waits out the countdown. */
  ballAnchor: Pt;
  /** The gadgets, in a fixed order: a barrier's state in the world is found by its place here. */
  barriers: readonly Barrier[];
  bumpers: readonly Bumper[];
  portals: readonly Portal[];
  goo: readonly Goo[];
  streams: readonly Stream[];
}
type Gadgets = "barriers" | "bumpers" | "portals" | "goo" | "streams";
/** A map as it is written down: the gadgets it does not have are left out. */
type MapSpec = Omit<MapDef, Gadgets> & Partial<Pick<MapDef, Gadgets>>;
const arena = (spec: MapSpec): MapDef => ({
  barriers: [],
  bumpers: [],
  portals: [],
  goo: [],
  streams: [],
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
 * A side wall 24 thick from `top` to `bottom` with a goal slot in it between `from` and `to`, as in Bounce Rate:
 * the slot's back is the last 6 pixels of the wall. `left` picks the side.
 */
const goalWall = (
  left: boolean,
  top: number,
  from: number,
  to: number,
  bottom: number,
): Rect[] => [
  rect(left ? 0 : 616, top, 24, from - top),
  rect(left ? 0 : 634, from, 6, to - from),
  rect(left ? 0 : 616, to, 24, bottom - to),
];
/** The slots of a pair of `goalWall`s: each rider's is in the far wall. */
const wallGoals = (from: number, to: number): Goal[] => [
  { team: 0, ...rect(616, from, 18, to - from) },
  { team: 1, ...rect(6, from, 18, to - from) },
];

/**
 * Quad Core is a closed box with four grass pads in two tiers and a goal slot high in each side wall. Under each
 * slot the wall is cut back into a notch, and below the notch it stands further in, so there is a shelf to stand on
 * right under the goal. The corners are stepped, so a ball rolled into one hops back out.
 */
const quadcore: MapDef = arena({
  id: "quadcore",
  name: "Quad Core",
  wrapX: false,
  wrapY: false,
  solids: [
    rect(0, 0, 640, 12),
    rect(0, 348, 640, 12),
    ...goalWall(true, 12, 90, 190, 206),
    ...goalWall(false, 12, 90, 190, 206),
    // The notch's back, and the thicker wall under it.
    rect(0, 206, 6, 76),
    rect(634, 206, 6, 76),
    rect(0, 282, 36, 66),
    rect(604, 282, 36, 66),
    // Stepped corners.
    rect(24, 12, 12, 10),
    rect(604, 12, 12, 10),
    rect(36, 326, 8, 22),
    rect(596, 326, 8, 22),
    rect(44, 338, 10, 10),
    rect(586, 338, 10, 10),
    rect(182, 190, 100, 10),
    rect(358, 190, 100, 10),
    rect(146, 272, 98, 10),
    rect(396, 272, 98, 10),
  ],
  goals: wallGoals(90, 190),
  clouds: [
    { x: 70, y: 140, r: 40 },
    { x: 570, y: 140, r: 40 },
  ],
  spawns: [
    { x: 120, y: 339 },
    { x: 520, y: 339 },
  ],
  ballAnchor: { x: 320, y: 120 },
});

/**
 * Bitstream wraps top to bottom. Two holes in the floor are the same shafts as the holes in the roof above them,
 * and nobody's goal: what drops in comes back from the top. The goals are slots in the side walls. The ball starts
 * over the wide pad in the middle, which stands over two jets: a ball rolled under it hops over them, or is caught and rides on one.
 */
const bitstream: MapDef = arena({
  id: "bitstream",
  name: "Bitstream",
  wrapX: false,
  wrapY: true,
  solids: [
    ...goalWall(true, 0, 90, 190, 360),
    ...goalWall(false, 0, 90, 190, 360),
    rect(24, 348, 140, 24),
    rect(208, 348, 224, 24),
    rect(476, 348, 140, 24),
    rect(182, 190, 108, 10),
    rect(350, 190, 108, 10),
    rect(92, 228, 62, 10),
    rect(486, 228, 62, 10),
    rect(254, 266, 132, 10),
  ],
  goals: wallGoals(90, 190),
  clouds: [
    { x: 68, y: 140, r: 40 },
    { x: 572, y: 140, r: 40 },
  ],
  spawns: [
    { x: 110, y: 339 },
    { x: 530, y: 339 },
  ],
  ballAnchor: { x: 320, y: 120 },
  streams: [
    { hue: 1, ...rect(276, 300, 16, 48) },
    { hue: 0, ...rect(348, 300, 16, 48) },
  ],
});

/**
 * Memory Leak wraps top to bottom, and only the two ends have a floor. The middle is one open shaft under a wide
 * pad; between it and each floor is a narrow pit, fenced by a tall pillar and a short post, with a pool of goo in
 * it. The pit has no bottom: a ball that sinks through the pool leaks out of the roof above it and falls down the
 * same column again, until somebody knocks it out of the air. Steps lead up to each post, two thin pillars hang at
 * mid height, and the goals are slots in the side walls.
 */
const memoryleak: MapDef = arena({
  id: "memoryleak",
  name: "Memory Leak",
  wrapX: false,
  wrapY: true,
  solids: [
    ...goalWall(true, 0, 90, 190, 360),
    ...goalWall(false, 0, 90, 190, 360),
    rect(24, 348, 150, 24),
    rect(466, 348, 150, 24),
    // Steps, then the post; the pit; the tall pillar. Post and pillar cross the seam and hang from the roof too.
    rect(150, 338, 24, 10),
    rect(466, 338, 24, 10),
    rect(162, 328, 12, 10),
    rect(466, 328, 12, 10),
    rect(174, 316, 8, 56),
    rect(458, 316, 8, 56),
    rect(234, 246, 8, 126),
    rect(398, 246, 8, 126),
    rect(138, 142, 8, 78),
    rect(494, 142, 8, 78),
    rect(246, 184, 148, 10),
  ],
  goals: wallGoals(90, 190),
  clouds: [
    { x: 68, y: 140, r: 40 },
    { x: 572, y: 140, r: 40 },
  ],
  spawns: [
    { x: 90, y: 339 },
    { x: 550, y: 339 },
  ],
  ballAnchor: { x: 320, y: 110 },
  goo: [
    { hue: 1, ...rect(182, 330, 52, 42) },
    { hue: 0, ...rect(406, 330, 52, 42) },
  ],
});

export const MAPS: Readonly<Record<MapId, MapDef>> = {
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
  quadcore,
  bitstream,
  memoryleak,
};
export const mapOf = (id: MapId): MapDef => MAPS[id];

/** A solid as the collision code wants it: centre and half extents, in sub-units. */
export interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}
const boxOf = (rect: Rect): Box => ({
  // Every rect has even sides, so the centre is a whole number of sub-units.
  cx: (rect.x * SUB * 2 + rect.w * SUB) / 2,
  cy: (rect.y * SUB * 2 + rect.h * SUB) / 2,
  hw: (rect.w * SUB) / 2,
  hh: (rect.h * SUB) / 2,
});
const BOXES = new Map<MapId, readonly Box[]>(
  MAP_IDS.map((id) => [id, MAPS[id].solids.map(boxOf)]),
);
/** The map's solids in sub-units; fixed data derived once from `MAPS`. */
export const boxesOf = (id: MapId): readonly Box[] => BOXES.get(id) ?? [];
const BARRIER_BOXES = new Map<MapId, readonly Box[]>(
  MAP_IDS.map((id) => [id, MAPS[id].barriers.map(boxOf)]),
);
/** A liquid's rect in sub-units, where it is and again one field back on each wrapping axis it runs past. */
const zonesOf = (map: MapDef, rects: readonly Rect[]): Rect[] =>
  rects.flatMap((r) => {
    const xs = map.wrapX && r.x + r.w > 640 ? [r.x, r.x - 640] : [r.x],
      ys = map.wrapY && r.y + r.h > 360 ? [r.y, r.y - 360] : [r.y];
    return xs.flatMap((x) =>
      ys.map((y) => rect(x * SUB, y * SUB, r.w * SUB, r.h * SUB)),
    );
  });
const GOO_ZONES = new Map<MapId, readonly Rect[]>(
  MAP_IDS.map((id) => [id, zonesOf(MAPS[id], MAPS[id].goo)]),
);
const STREAM_ZONES = new Map<MapId, readonly Rect[]>(
  MAP_IDS.map((id) => [id, zonesOf(MAPS[id], MAPS[id].streams)]),
);
/** The map's goo and streams as sub-unit rects, each one in the field. */
export const gooZonesOf = (id: MapId): readonly Rect[] =>
  GOO_ZONES.get(id) ?? [];
export const streamZonesOf = (id: MapId): readonly Rect[] =>
  STREAM_ZONES.get(id) ?? [];
/** The map's barriers in sub-units, in the order of `MapDef.barriers`. */
export const barrierBoxesOf = (id: MapId): readonly Box[] =>
  BARRIER_BOXES.get(id) ?? [];
