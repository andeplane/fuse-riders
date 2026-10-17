/**
 * The constants every layer agrees on. Positions are whole sub-pixels (`SUB` per art pixel, `TILE_PX` art pixels per
 * tile), timers count steps, and the simulation runs `STEPS_PER_TICK` steps per 50 ms log tick.
 */
import { ceilDiv } from "./math.js";

/** Bump on any change to the rules, with the golden in `tests/golden.test.ts` re-recorded in the same commit. */
export const RULES = "fuse-front-3";

export const SUB = 16;
export const TILE_PX = 8;
/** One tile in sub-pixels. */
export const TILE = SUB * TILE_PX;

export const TICK_MS = 50;
export const STEPS_PER_TICK = 2;
export const STEPS_PER_SECOND = (1000 / TICK_MS) * STEPS_PER_TICK;

/** Seats 0–5; a seat's team is `seat % 2`, so seats 0, 2 and 4 play west against 1, 3 and 5. */
export const MAX_SEATS = 6;
export const teamOf = (seat: number): number => seat % 2;

export const STANCES = ["push", "hold", "follow"] as const;
export type Stance = (typeof STANCES)[number];

export const UNIT_KINDS = ["grunt", "torch", "lightTank"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export interface UnitStats {
  /** Steps to build one batch at the base clock (one team sector). */
  build: number;
  /** Units a finished build spawns: grunts come in threes. */
  batch: number;
  /** Robots capture flags; vehicles cannot. */
  robot: boolean;
  hp: number;
  /** Sub-pixels per step. */
  speed: number;
  /** Sub-pixels: two units closer than the sum of their radii push apart. */
  radius: number;
  /** Sub-pixels. */
  range: number;
  damage: number;
  /** Steps between shots. */
  cooldown: number;
  /** Percent of `damage` a shot does to a turret or fort. */
  siege: number;
}

const s = (seconds: number): number => seconds * STEPS_PER_SECOND;

export const UNITS: Readonly<Record<UnitKind, Readonly<UnitStats>>> = {
  grunt: {
    build: s(12),
    batch: 3,
    robot: true,
    hp: 60,
    speed: 10,
    radius: 40,
    range: 5 * TILE,
    damage: 6,
    cooldown: s(1),
    siege: 50,
  },
  torch: {
    build: s(10),
    batch: 1,
    robot: true,
    hp: 90,
    speed: 9,
    radius: 44,
    range: 2 * TILE,
    damage: 4,
    cooldown: 8,
    siege: 150,
  },
  lightTank: {
    build: s(16),
    batch: 1,
    robot: false,
    hp: 260,
    speed: 14,
    radius: 64,
    range: 6 * TILE,
    damage: 22,
    cooldown: s(2),
    siege: 100,
  },
};

export const BUILDING_KINDS = [
  "robotFactory",
  "vehicleFactory",
  "turret",
  "fort",
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/** What each factory can be ordered to build; the first is its order when it changes hands. Others build nothing. */
export const FACTORY_KINDS: Readonly<
  Record<BuildingKind, readonly UnitKind[]>
> = {
  robotFactory: ["grunt", "torch"],
  vehicleFactory: ["lightTank"],
  turret: [],
  fort: [],
};

export const BUILDING_HP: Readonly<Record<BuildingKind, number>> = {
  robotFactory: 1200,
  vehicleFactory: 1400,
  turret: 600,
  fort: 4000,
};

/**
 * A turret held by a seat fires like a unit (`combat.ts`); a neutral one is idle and cannot be hit. Forts do not fire.
 * Sub-pixels and steps, as `UnitStats`.
 */
export const TURRET = { range: 6 * TILE, damage: 18, cooldown: s(1) } as const;

/** A player's factories pause while that player has this many units. */
export const UNIT_CAP = 40;
/** Commands a seat may apply per step; the rest are dropped. */
export const COMMANDS_PER_SEAT = 4;

/**
 * The production clock: each sector the team holds beyond the first adds `CLOCK_PER_SECTOR` percent, up to
 * `CLOCK_MAX` percent (so a build never takes less than half its base time). A factory gains `clockRate` progress per
 * step and finishes at `build * 100`, which makes a build take `ceil(build * 100 / rate)` steps.
 */
export const CLOCK_PER_SECTOR = 15;
export const CLOCK_MAX = 200;

export function clockRate(teamSectors: number): number {
  const rate = 100 + CLOCK_PER_SECTOR * (teamSectors > 1 ? teamSectors - 1 : 0);
  return rate > CLOCK_MAX ? CLOCK_MAX : rate;
}

/** Steps one batch of `kind` takes on a team holding `teamSectors` sectors. */
export function buildSteps(kind: UnitKind, teamSectors: number): number {
  return ceilDiv(UNITS[kind].build * 100, clockRate(teamSectors));
}

/**
 * Stances (`move.ts`). A unit picks its goal every `RETHINK_STEPS` steps, staggered by id, and at once when it has
 * none or its owner changes stance. Costs are flow-field units: `STRAIGHT` a tile across, `DIAGONAL` a tile corner to
 * corner. A holding unit stops within `HOLD_RADIUS` of its flag, and counts `HOLD_CROWD` extra per teammate already
 * holding a flag, so a team spreads over its flags instead of piling onto the nearest.
 */
export const RETHINK_STEPS = 20;
export const STRAIGHT = 10;
export const DIAGONAL = 14;
export const HOLD_RADIUS = 3 * STRAIGHT;
export const HOLD_CROWD = 2 * STRAIGHT;
