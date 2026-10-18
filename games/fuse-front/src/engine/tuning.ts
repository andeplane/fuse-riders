/**
 * The constants every layer agrees on. Positions are whole sub-pixels (`SUB` per art pixel, `TILE_PX` art pixels per
 * tile), timers count steps, and the simulation runs `STEPS_PER_TICK` steps per 50 ms log tick.
 */
import { ceilDiv } from "./math.js";

/** Bump on any change to the rules, with the golden in `tests/golden.test.ts` re-recorded in the same commit. */
export const RULES = "fuse-front-9";

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

/** A `sentry` is Rivet's TURRET DROP (`spells.ts`): no factory builds one, it never moves and it burns out. */
export const UNIT_KINDS = ["grunt", "torch", "lightTank", "sentry"] as const;
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
  // prettier-ignore
  sentry: { build: 0, batch: 0, robot: false, hp: 400, speed: 0, radius: 48, range: 6 * TILE, damage: 16,
    cooldown: s(1), siege: 50 },
};
/** A sentry loses a hit point every `SENTRY_DECAY` steps, so an unhurt one stands 40 seconds. */
export const SENTRY_DECAY = 2;

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
 * A turret held by a seat fires like a unit (`combat.ts`); a neutral one is idle and cannot be hit. A standing fort
 * fires its heavy gun at enemy units and heroes (never buildings), so a lone hero or a thin push cannot simply walk
 * in; tanks outrange it, so they are the siege. Sub-pixels and steps, as `UnitStats`.
 */
export const TURRET = { range: 6 * TILE, damage: 18, cooldown: s(1) } as const;
export const FORT_GUN = {
  range: 5 * TILE,
  damage: 60,
  cooldown: s(1.5),
} as const;

/**
 * The unit cap grows with territory: a player's factories pause at `UNIT_CAP_BASE` plus `UNIT_CAP_PER_SECTOR` for
 * each sector the team holds, shared among the team's players, never above `UNIT_CAP` (`unitCap` in `world.ts`). A
 * cap that shrinks kills nothing; the player just builds nothing until it is under it again.
 */
export const UNIT_CAP_BASE = 10;
export const UNIT_CAP_PER_SECTOR = 4;
export const UNIT_CAP = 48;
/** Commands a seat may apply per step; the rest are dropped. */
export const COMMANDS_PER_SEAT = 4;

/**
 * The production clock: each sector the team holds beyond the first adds `CLOCK_PER_SECTOR` percent, up to
 * `CLOCK_MAX` percent (so a build never takes less than half its base time). A factory gains `clockRate` progress per
 * step and finishes at `build * 100`, which makes a build take `ceil(build * 100 / rate)` steps.
 */
export const CLOCK_PER_SECTOR = 15;
export const CLOCK_MAX = 200;

/**
 * Overtime: from `OVERTIME_AFTER` steps into a match, the team holding more sectors than the other builds faster,
 * `OVERTIME_GROWTH` percent more for each minute past it, up to `OVERTIME_MAX` percent (`productionRate`, `step.ts`).
 */
export const OVERTIME_AFTER = s(8 * 60);
export const OVERTIME_GROWTH = 40;
export const OVERTIME_MAX = 300;

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

/**
 * The hero (`hero.ts`), with Brick's profile (`HEROES` has the others'): a powerhouse worth a squad. Each player has
 * one; it walks where it is sent (`move`) or steered (`steer`), shoots the nearest enemy in range whether idle or
 * walking, captures flags like a robot and is a target like a unit. Its stats grow with its level; sub-pixels and
 * steps, as `UnitStats`.
 */
export const HERO = {
  speed: 12,
  range: 5 * TILE,
  cooldown: s(1),
  siege: 50,
  /** Hit points and damage at level 1, and what each level adds. */
  hp: 900,
  hpPerLevel: 70,
  damage: 40,
  damagePerLevel: 5,
  /** Enemy units within `splash` of the hero's target also take `splashPercent` of the shot. */
  splash: TILE,
  splashPercent: 50,
  /** Percent of a robot's (grunt's or torch's) damage a hero takes; tanks, turrets, forts and heroes hit in full. */
  smallArms: 50,
  /** Energy at level 1 and per level; one point regenerates every `energyEvery` steps, `calmEnergyEvery` when calm. */
  energy: 100,
  energyPerLevel: 10,
  energyEvery: 20,
  calmEnergyEvery: 5,
  /** Steps without shooting or being hit before a hero is calm, and the hit points a calm hero heals each step. */
  calm: s(3),
  regen: 1,
  /** Steps dead before respawning at the fort: `respawn + respawnPerLevel * level`. */
  respawn: s(6),
  respawnPerLevel: s(2),
} as const;

/**
 * The heroes a player picks from, each with a profile over `HERO`'s shared rules: Brick the armoured frontliner,
 * Vix the fast, fragile long-range infiltrator, Rivet the engineer with a weaker gun and Tally the fastest scout.
 */
export const HERO_KINDS = ["brick", "vix", "rivet", "tally"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
export interface HeroStats {
  hp: number;
  hpPerLevel: number;
  damage: number;
  damagePerLevel: number;
  /** Sub-pixels per step, and sub-pixels. */
  speed: number;
  range: number;
}
// prettier-ignore
export const HEROES: Readonly<Record<HeroKind, Readonly<HeroStats>>> = {
  brick: HERO,
  vix: { hp: 600, hpPerLevel: 45, damage: 48, damagePerLevel: 6, speed: 15, range: 7 * TILE },
  rivet: { hp: 760, hpPerLevel: 55, damage: 32, damagePerLevel: 4, speed: 12, range: 5 * TILE },
  tally: { hp: 620, hpPerLevel: 45, damage: 36, damagePerLevel: 5, speed: 16, range: 5 * TILE },
};

export const MAX_LEVEL = 10;
/** Total XP each level needs: level n is reached at `XP_STEP * n * (n - 1) / 2`. */
export const XP_STEP = 30;
/** XP for killing a unit of each kind, a hero (plus `HERO_XP_PER_LEVEL` per victim level), and taking a flag. */
export const KILL_XP: Readonly<Record<UnitKind, number>> = {
  grunt: 12,
  torch: 16,
  lightTank: 30,
  sentry: 20,
};
export const HERO_XP = 60;
export const HERO_XP_PER_LEVEL = 15;
export const CAPTURE_XP = 40;
/** Teammates' living heroes this close to a kill get half its XP (sub-pixels). */
export const ASSIST_RADIUS = 8 * TILE;
/** A robot this close to its owner's living hero does `AURA_DAMAGE` percent damage. */
export const AURA_RADIUS = 6 * TILE;
export const AURA_DAMAGE = 115;
/** A robot under RALLY CRY walks this many percent faster (`spells.ts`). */
export const RALLY_SPEED = 40;
/** A robot under its owner's BLITZ, in the sector its hero stands in, walks this many percent faster. */
export const BLITZ_SPEED = 50;
/** `steer` takes each axis in -STEER_MAX..STEER_MAX; the hero walks at full speed from a magnitude of STEER_MAX. */
export const STEER_MAX = 8;
