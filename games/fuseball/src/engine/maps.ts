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
] as const;
export type MapId = (typeof MAP_IDS)[number];
export const isMapId = (value: unknown): value is MapId =>
  typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);

export interface MapDef {
  id: MapId;
  name: string;
  wrapX: boolean;
  wrapY: boolean;
  solids: readonly Rect[];
  goals: readonly Goal[];
  /** While the ball's centre is inside one, the whole arena runs at half speed. */
  clouds: readonly Circle[];
  /** Where each slot's rider stands (its centre) when a point starts. */
  spawns: readonly [Pt, Pt];
  /** Where the ball's centre waits out the countdown. */
  ballAnchor: Pt;
}

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
const gridlock: MapDef = {
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
};

/**
 * Downlink wraps top to bottom. Solid side walls, and one slab across the seam with two shafts through it: a shaft
 * is a goal along its whole length, so the ball dropped into a pit or knocked up through the roof above it scores.
 */
const downlink: MapDef = {
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
};

/**
 * Halo wraps both ways: no walls at all, four floating pads, the ball on a pedestal in the middle and a round goal
 * hanging high on each side.
 */
const halo: MapDef = {
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
};

/**
 * Overflow wraps both ways. The seam wall has the goals in its gap, as in Gridlock, but the floor has two holes that
 * are nobody's goal: whatever drops through one comes back in at the top, over the high ledges. The wall and the
 * floor slab each cross a seam, so the wall's two ends and the floor and ceiling are one rect apiece.
 */
const overflow: MapDef = {
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
};

/**
 * Firewall wraps both ways and has no floor or ceiling at all: whatever is not standing on a pad falls for ever,
 * out of the bottom and in at the top. The goals are the gaps in the seam wall, each behind a short wall of its own
 * that the ball has to be sent over or under. The ball starts in the open and lands on the high pad from above.
 */
const firewall: MapDef = {
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
};

/**
 * Corner Case wraps top to bottom. The goals are the four corners: a pocket between each side wall and the end of
 * the floor, which is the same shaft as the pocket in the roof above it. A kerb stands at the edge of every pocket
 * (and hangs from the roof beside it), so a ball rolled along the floor stops short and has to be lifted in. The
 * ball starts on the anvil in the middle.
 */
const cornercase: MapDef = {
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
};

/**
 * Core Dump wraps top to bottom. Both goals are pits side by side in the middle of the floor, with a post between
 * them, and each is the same shaft as the opening in the roof above it. A rider's pit is the far one, so a ball on
 * their own half of the floor has to go over the near pit, which is the other colour's. A roof hangs over both
 * pits; the ball starts on it.
 */
const coredump: MapDef = {
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
};

export const MAPS: Readonly<Record<MapId, MapDef>> = {
  gridlock,
  downlink,
  halo,
  overflow,
  firewall,
  cornercase,
  coredump,
};
export const mapOf = (id: MapId): MapDef => MAPS[id];

/** A solid as the collision code wants it: centre and half extents, in sub-units. */
export interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}
const BOXES = new Map<MapId, readonly Box[]>(
  MAP_IDS.map((id) => [
    id,
    MAPS[id].solids.map((solid) => ({
      // Every rect has even sides, so the centre is a whole number of sub-units.
      cx: (solid.x * SUB * 2 + solid.w * SUB) / 2,
      cy: (solid.y * SUB * 2 + solid.h * SUB) / 2,
      hw: (solid.w * SUB) / 2,
      hh: (solid.h * SUB) / 2,
    })),
  ]),
);
/** The map's solids in sub-units; fixed data derived once from `MAPS`. */
export const boxesOf = (id: MapId): readonly Box[] => BOXES.get(id) ?? [];
