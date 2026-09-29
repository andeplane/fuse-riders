export type MapId = "belfry" | "crossroads" | "spire";
export type Platform = readonly [number, number, number, number];
/** A jump pad's top surface: x, top y and width, world units. */
export type Pad = readonly [number, number, number];
/**
 * A laser gate (12B). The beam is a line `length` long, horizontal ("h",
 * spanning x…x+length at y) or vertical ("v", spanning y…y+length at x). While
 * live it sweeps `travel` units across its axis (down for "h", right for "v").
 * `offset` shifts the gate's place in the shared schedule, in ticks.
 */
export interface Laser {
  readonly axis: "h" | "v";
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly travel: number;
  readonly offset: number;
}
/** Zone data (12B); each kind is switched by its own shared setting. */
export interface Zones {
  readonly pads: readonly Pad[];
  readonly lifts: readonly Platform[];
  readonly lowGravity: readonly Platform[];
  /** The electrified strip's top at rest and where sudden death stops it. */
  readonly floor: { readonly base: number; readonly cap: number } | null;
  readonly lasers: readonly Laser[];
  readonly bonus: Platform | null;
}
interface Layout {
  /** World size in units; the arena's walls and its out-of-bounds line. */
  readonly width: number;
  readonly height: number;
  /** Every surface in stable order: hooks, orbs, bombs and checkpoints index it. */
  readonly platforms: readonly Platform[];
  /**
   * Indices of platforms that are solid to keepers from every side: walls,
   * pillars and ceilings (12A). The rest are one-way ledges.
   */
  readonly solid: readonly number[];
  readonly spawns: readonly (readonly [number, number])[];
  readonly target: readonly [number, number];
  readonly ballField: readonly [number, number, number, number];
  readonly ballSpawn: readonly [number, number];
  /** Where the arena ricochet orb starts. */
  readonly arenaBall: readonly [number, number];
  readonly zones: Zones;
}
const NO_ZONES: Zones = {
  pads: [],
  lifts: [],
  lowGravity: [],
  floor: null,
  lasers: [],
  bonus: null,
};
/** World units; stable platform order is part of the collision and checkpoint contract. */
export const MAPS: Readonly<Record<MapId, Layout>> = {
  belfry: {
    width: 1600,
    height: 900,
    platforms: [
      [120, 810, 400, 40],
      [220, 670, 220, 28],
      [570, 610, 240, 28],
      [250, 470, 230, 28],
      [950, 480, 250, 28],
      [620, 330, 260, 28],
      [1170, 270, 250, 28],
      [670, 120, 300, 28],
    ],
    solid: [],
    spawns: [
      [310, 810],
      [170, 810],
      [240, 810],
      [380, 810],
      [450, 810],
    ],
    target: [450, 810],
    ballField: [850, 650, 600, 200],
    ballSpawn: [940, 720],
    arenaBall: [940, 740],
    zones: NO_ZONES,
  },
  crossroads: {
    width: 1600,
    height: 900,
    platforms: [
      [80, 810, 200, 32],
      [390, 810, 200, 32],
      [700, 810, 200, 32],
      [1010, 810, 200, 32],
      [1320, 810, 200, 32],
      [330, 660, 260, 28],
      [690, 660, 220, 28],
      [1010, 660, 260, 28],
      [90, 510, 280, 28],
      [660, 510, 280, 28],
      [1230, 510, 280, 28],
      [350, 360, 280, 28],
      [970, 360, 280, 28],
      [650, 210, 300, 28],
    ],
    solid: [],
    spawns: [
      [180, 810],
      [1420, 810],
      [800, 810],
      [490, 810],
      [1110, 810],
    ],
    target: [850, 810],
    ballField: [600, 610, 400, 200],
    ballSpawn: [800, 700],
    arenaBall: [800, 740],
    zones: NO_ZONES,
  },
  /**
   * Neon Spire (12A–12B): a 1.4× split tower, 2240 × 1260. Three tiers of
   * catwalks around a solid core, lift shafts either side, a low-gravity right
   * wing, a crown chamber on top and an electrified floor below. Spawns sit on
   * the middle tier, above the floor's sudden-death cap and clear of every
   * laser, lift and pad.
   */
  spire: {
    width: 2240,
    height: 1260,
    platforms: [
      // Bottom tier.
      [80, 1100, 520, 28],
      [720, 1110, 800, 28],
      [1640, 1100, 520, 28],
      // Middle tier.
      [120, 780, 380, 28],
      [800, 780, 280, 28],
      [1160, 780, 280, 28],
      [1740, 780, 380, 28],
      // Top tier.
      [140, 420, 360, 28],
      [800, 440, 280, 24],
      [1160, 440, 280, 24],
      [1740, 420, 360, 28],
      // Crown deck.
      [900, 240, 440, 28],
      // Solid: the core that splits the tower, a hurdle, two overhangs,
      // the crown's pylons and its roof.
      [1080, 440, 80, 368],
      [1080, 980, 80, 130],
      [120, 560, 260, 24],
      [1860, 560, 260, 24],
      [880, 190, 20, 78],
      [1340, 190, 20, 78],
      [900, 60, 440, 20],
    ],
    solid: [12, 13, 14, 15, 16, 17, 18],
    spawns: [
      [260, 780],
      [1980, 780],
      [940, 780],
      [1300, 780],
      [440, 780],
    ],
    target: [1300, 780],
    ballField: [760, 820, 720, 150],
    ballSpawn: [900, 880],
    arenaBall: [900, 950],
    zones: {
      pads: [
        [820, 1110, 80],
        [1340, 1110, 80],
      ],
      lifts: [
        [610, 300, 100, 880],
        [1530, 300, 100, 880],
      ],
      lowGravity: [[1720, 100, 520, 900]],
      floor: { base: 1220, cap: 830 },
      lasers: [
        { axis: "h", x: 40, y: 250, length: 480, travel: 160, offset: 0 },
        { axis: "v", x: 720, y: 830, length: 280, travel: 800, offset: 240 },
      ],
      bonus: [900, 80, 440, 160],
    },
  },
};
export const isMapId = (value: unknown): value is MapId =>
  value === "belfry" || value === "crossroads" || value === "spire";
const split = new Map<MapId, { ledges: Platform[]; blocks: Platform[] }>();
function terrain(map: MapId) {
  let parts = split.get(map);
  if (!parts) {
    const layout = MAPS[map];
    parts = {
      ledges: layout.platforms.filter((_, i) => !layout.solid.includes(i)),
      blocks: layout.solid.map((i) => layout.platforms[i]!),
    };
    split.set(map, parts);
  }
  return parts;
}
/** One-way ledges: keepers land on their tops while falling and pass through otherwise. */
export const ledges = (map: MapId): readonly Platform[] => terrain(map).ledges;
/** Solid blocks: keepers collide with every face. */
export const blocks = (map: MapId): readonly Platform[] => terrain(map).blocks;
