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

export const MAP_IDS = ["gridlock", "downlink", "halo"] as const;
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

export const MAPS: Readonly<Record<MapId, MapDef>> = {
  gridlock,
  downlink,
  halo,
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
