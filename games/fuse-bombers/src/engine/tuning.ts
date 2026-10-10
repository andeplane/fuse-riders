// World constants and gameplay tuning. All distances are logical world pixels (y grows downward),
// all speeds are pixels per second and all durations are seconds unless the name says otherwise.

import { TEMPLE_MAP } from "./temple-map.js";

/** Logical world width in pixels: the temple map's (4800). The renderer frames the world on screen. */
export const WORLD_WIDTH = TEMPLE_MAP.width;
/** Logical world height in pixels (2700). */
export const WORLD_HEIGHT = TEMPLE_MAP.height;
/** Simulation rate. One `step` call advances exactly one tick. */
export const TICK_HZ = 60;
/** Seconds per tick. */
export const DT = 1 / TICK_HZ;
/** Physics sub-steps per tick for rockets (keeps fast rockets from skipping thin targets). */
export const SUBSTEPS = 2;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Power-up cards a crate can hold. */
export type Card = "unit" | "shield" | "rapid" | "repair" | "mega";
export const CARDS: readonly Card[] = [
  "unit",
  "shield",
  "rapid",
  "repair",
  "mega",
];

export interface Tuning {
  // Physics
  gravity: number;
  launchSpeed: number;
  /** Distance from the launcher pivot to the barrel tip, where rockets appear. */
  barrelLength: number;
  rocketRadius: number;
  /** Rockets older than this are removed (safety net; normal rockets land long before). */
  rocketMaxAge: number;
  /** Hard cap on live rockets (volleys, splits and bombs together; ghost bombs bypass it). */
  maxRockets: number;
  /** Gate splits stop creating new rockets above `maxRockets - splitReserve` (they add power instead). */
  splitReserve: number;

  // Castles
  /**
   * Castle HP by player count (index = players). Small rounds get tougher castles and big rounds
   * weaker ones, so a round with decent aim lasts about a minute whatever the player count.
   */
  castleHp: readonly number[];
  /** Radius of the castle's hit circle, centred on the hull (`x, y`). */
  castleRadius: number;
  /** Launcher pivot height above the hull centre. */
  launcherOffset: number;
  startUnits: number;
  maxUnits: number;
  reloadTime: number;
  minReloadTime: number;
  /** Delay before the first volley of a round. */
  initialReload: number;
  /** Ticks between rockets of one volley (shrinks for big volleys so a volley lasts <= volleyMaxTime). */
  volleyIntervalTicks: number;
  volleyMaxTime: number;
  /** Per-rocket random angle spread (degrees, +/-). */
  spreadDeg: number;
  /** Per-rocket random launch speed spread (fraction, +/-). */
  speedJitter: number;
  /** Seconds for one full counter-clockwise turn of the launcher. */
  aimPeriod: number;

  // Damage
  rocketDamage: number;
  /** Fraction of damage a castle takes from an explosion within reach of it. */
  splashFactor: number;
  craterRadius: number;
  megaDamageFactor: number;
  megaCraterFactor: number;
  /** Crater dug when a castle explodes. */
  wreckCraterRadius: number;

  // Shields and cards
  shieldRadius: number;
  shieldPerCard: number;
  shieldMax: number;
  rapidFactor: number;
  repairAmount: number;
  cardWeights: Readonly<Record<Card, number>>;

  // Gates
  /** Gate count by player count (index = players). */
  gateCounts: readonly number[];
  gateMultipliers: readonly { multiplier: number; weight: number }[];
  gateWidth: number;
  gateHeight: number;
  gateLife: readonly [number, number];
  gateDriftSpeed: readonly [number, number];
  /** Half-width of the horizontal range a gate drifts in (less when its sky zone is narrower). */
  gateDriftRange: number;
  /** Gap kept between the areas two live gates sweep while drifting and bobbing, so gates never overlap. */
  gateSpacing: number;
  gateBobAmp: number;
  gateBobPeriod: number;
  /** Total fan angle (degrees) of split children, per extra child, capped by `splitFanMaxDeg`. */
  splitFanPerChildDeg: number;
  splitFanMaxDeg: number;
  splitSpeedJitter: number;

  // Crates
  crateCounts: readonly number[];
  crateRadius: number;
  firstCrateDelay: number;
  crateRespawn: readonly [number, number];

  // Fuse and sudden death
  fuseTime: number;
  /** Hard stop: the round is decided on HP at this time if nobody has won yet. */
  maxRoundTime: number;
  bombDamage: number;
  bombCraterRadius: number;
  bombIntervalStart: number;
  bombIntervalMin: number;
  /** Seconds of sudden death for the bomb interval to go from start to min. */
  bombRampTime: number;
  /** Horizontal scatter of bombs around their target castle, at start and at the end of the ramp. */
  bombScatter: readonly [number, number];
  /** Bombs appear this far above their target castle (lower under a ceiling of rock, never above the world). */
  bombHeight: number;
  /** All damage is multiplied by 1 + suddenDeathSeconds / damageRampTime. */
  damageRampTime: number;

  // Ghost bombers
  /** Players whose castle is destroyed fly a ghost blimp that drops bombs. */
  ghosts: boolean;
  /** A ghost blimp flies this far above its wreck (at least `ghostMargin` below the top of the world). */
  ghostRise: number;
  ghostSpeed: number;
  /** Ghosts bounce this far from the world edges. */
  ghostMargin: number;
  ghostReload: number;
  /** Delay before a fresh ghost's first bomb. */
  ghostFirstReload: number;
  /** Direct-hit damage of a ghost bomb (splash deals `splashFactor` of it). Gates never multiply it. */
  ghostBombDamage: number;
  ghostCraterRadius: number;
  /** Initial downward speed of a dropped bomb. */
  ghostBombSpeed: number;
}

export const DEFAULT_TUNING: Tuning = {
  gravity: 500,
  launchSpeed: 900,
  barrelLength: 20,
  rocketRadius: 4,
  rocketMaxAge: 12,
  maxRockets: 1500,
  splitReserve: 150,

  castleHp: [0, 0, 280, 220, 150, 130, 120],
  castleRadius: 34,
  launcherOffset: 32,
  startUnits: 5,
  maxUnits: 30,
  reloadTime: 2.6,
  minReloadTime: 1.2,
  initialReload: 1.2,
  volleyIntervalTicks: 5,
  volleyMaxTime: 1.0,
  spreadDeg: 1.2,
  speedJitter: 0.015,
  aimPeriod: 3.6,

  rocketDamage: 4,
  splashFactor: 0.5,
  craterRadius: 11,
  megaDamageFactor: 3,
  megaCraterFactor: 2.5,
  wreckCraterRadius: 46,

  shieldRadius: 60,
  shieldPerCard: 50,
  shieldMax: 100,
  rapidFactor: 0.75,
  repairAmount: 40,
  cardWeights: { unit: 3, shield: 2, rapid: 2, repair: 1.5, mega: 1.5 },

  gateCounts: [0, 0, 5, 5, 6, 6, 7],
  gateMultipliers: [
    { multiplier: 2, weight: 4 },
    { multiplier: 3, weight: 3 },
    { multiplier: 5, weight: 2 },
    { multiplier: 10, weight: 1 },
  ],
  gateWidth: 22,
  gateHeight: 110,
  gateLife: [14, 22],
  gateDriftSpeed: [12, 30],
  gateDriftRange: 170,
  gateSpacing: 80,
  gateBobAmp: 14,
  gateBobPeriod: 3.5,
  splitFanPerChildDeg: 2.5,
  splitFanMaxDeg: 22,
  splitSpeedJitter: 0.03,

  crateCounts: [0, 0, 4, 4, 5, 5, 6],
  crateRadius: 20,
  firstCrateDelay: 3,
  crateRespawn: [5, 9],

  fuseTime: 90,
  maxRoundTime: 180,
  bombDamage: 6,
  bombCraterRadius: 16,
  bombIntervalStart: 1.0,
  bombIntervalMin: 0.1,
  bombRampTime: 40,
  bombScatter: [320, 40],
  bombHeight: 600,
  damageRampTime: 30,

  ghosts: true,
  ghostRise: 220,
  ghostSpeed: 160,
  ghostMargin: 40,
  ghostReload: 3.5,
  ghostFirstReload: 2.5,
  ghostBombDamage: 7,
  ghostCraterRadius: 18,
  ghostBombSpeed: 60,
};

/** Shortest `aimPeriod`: two ticks a revolution, so `turnLauncher`'s single wrap-around subtraction always suffices. */
export const MIN_AIM_PERIOD = 2 * DT;

/**
 * The defaults with `overrides` on top. Throws `RangeError` for an `aimPeriod` that is not a finite number of at
 * least `MIN_AIM_PERIOD` seconds (zero would turn the launcher by an infinite angle, a shorter one past what
 * `turnLauncher` wraps), since this is where a round's configuration enters.
 */
export function resolveTuning(overrides?: Partial<Tuning>): Tuning {
  const tuning = { ...DEFAULT_TUNING, ...overrides };
  if (!Number.isFinite(tuning.aimPeriod) || tuning.aimPeriod < MIN_AIM_PERIOD)
    throw new RangeError(
      `aimPeriod must be a finite number of at least ${MIN_AIM_PERIOD} s`,
    );
  return tuning;
}

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * TICK_HZ));
}
