import { BASE_STATS, config, type TruckStats } from './config.js';
import { nextRandom } from './rng.js';
import type { RaceState } from './race.js';

export type UpgradeKind = 'topSpeed' | 'accel' | 'tires' | 'shocks' | 'armor' | 'nitro';

/** Per-level cost tables and effects (ADR 006). */
export const UPGRADES: Record<UpgradeKind, { levels: number; costs: readonly number[]; label: string }> = {
  topSpeed: { levels: 5, costs: [600, 900, 1300, 1800, 2400], label: 'TOP SPEED' },
  accel: { levels: 5, costs: [600, 900, 1300, 1800, 2400], label: 'ACCELERATION' },
  tires: { levels: 5, costs: [600, 900, 1300, 1800, 2400], label: 'TIRES' },
  shocks: { levels: 5, costs: [600, 900, 1300, 1800, 2400], label: 'SHOCKS' },
  armor: { levels: 3, costs: [900, 1500, 2400], label: 'ARMOR' },
  nitro: { levels: 3, costs: [500, 500, 500], label: 'NITRO' },
};
const ORDER: UpgradeKind[] = ['topSpeed', 'accel', 'tires', 'shocks', 'armor', 'nitro'];
const deg = (d: number) => (d * Math.PI) / 180;

export interface Driver {
  slot: number;
  money: number;
  /** Lifetime prize money, the tie-break (ADR 006); `money` is what is left to spend. */
  earned: number;
  points: number;
  kills: number;
  deaths: number;
  lapsLed: number;
  nitrosUsed: number;
  levels: Record<UpgradeKind, number>;
}

export interface Series {
  raceIndex: number;
  /** Track names in order, chosen by seeded shuffle without repeats. */
  tracks: string[];
  drivers: Driver[];
}

export function statsFor(levels: Record<UpgradeKind, number>): TruckStats {
  return {
    topSpeed: BASE_STATS.topSpeed + 10 * levels.topSpeed,
    accelTime: BASE_STATS.accelTime - 0.08 * levels.accel,
    // Five levels close the whole gap to the at-rest rate: the best tyres keep your full turn at top speed.
    turnRateHigh: BASE_STATS.turnRateHigh + deg(18) * levels.tires,
    landingMul: BASE_STATS.landingMul + 0.03 * levels.shocks,
    maxArmor: BASE_STATS.maxArmor + levels.armor,
    nitros: Math.min(config.truck.nitroMax, BASE_STATS.nitros + levels.nitro),
    mass: BASE_STATS.mass + 0.15 * levels.armor,
  };
}

export const NO_LEVELS: Record<UpgradeKind, number> = { topSpeed: 0, accel: 0, tires: 0, shocks: 0, armor: 0, nitro: 0 };

export function createSeries(trackNames: string[], slots: number, seed: number, races = 5): Series {
  let rng = seed >>> 0;
  const pool = trackNames.slice();
  const tracks: string[] = [];
  while (tracks.length < races) {
    if (pool.length === 0) pool.push(...trackNames);
    const [r, next] = nextRandom(rng);
    rng = next;
    // Splicing one entry out of a pool the loop above keeps non-empty always yields that entry.
    tracks.push(pool.splice(Math.floor(r * pool.length), 1)[0]!);
  }
  return { raceIndex: 0, tracks, drivers: Array.from({ length: slots }, (_, slot) => ({ slot, money: 0, earned: 0, points: 0, kills: 0, deaths: 0, lapsLed: 0, nitrosUsed: 0, levels: { ...NO_LEVELS } })) };
}

/** Prize money and points from a finished race, by placement (ADR 006). */
export function applyRace(series: Series, state: RaceState): Series {
  const drivers = series.drivers.map((d) => {
    const place = state.placements.indexOf(d.slot);
    const t = state.trucks[d.slot]!; // A driver's slot is a truck slot in the race it just ran.
    const prize = (config.prize[place] ?? 0) + t.kills * config.killBonus;
    return { ...d, points: d.points + (config.points[place] ?? 0), money: d.money + prize, earned: d.earned + prize, kills: d.kills + t.kills, deaths: d.deaths + t.deaths, lapsLed: d.lapsLed + t.lapsLed, nitrosUsed: d.nitrosUsed + t.nitrosUsed };
  });
  return { ...series, raceIndex: series.raceIndex + 1, drivers };
}

export function cost(d: Driver, kind: UpgradeKind): number | null {
  const u = UPGRADES[kind];
  // Below the cap, and the cost table has one price per level.
  return d.levels[kind] >= u.levels ? null : u.costs[d.levels[kind]]!;
}

/** Returns the driver after buying, or null if unaffordable or maxed. */
export function buy(d: Driver, kind: UpgradeKind): Driver | null {
  const c = cost(d, kind);
  if (c === null || c > d.money) return null;
  return { ...d, money: d.money - c, levels: { ...d.levels, [kind]: d.levels[kind] + 1 } };
}

/** Bots buy the cheapest affordable upgrade, ties in row order, until nothing is affordable (ADR 006). */
export function botShop(d: Driver): Driver {
  let cur = d;
  for (;;) {
    const options = ORDER.map((k) => ({ k, c: cost(cur, k) })).filter((o): o is { k: UpgradeKind; c: number } => o.c !== null && o.c <= cur.money).sort((a, b) => a.c - b.c);
    const [cheapest] = options;
    if (!cheapest) return cur;
    cur = buy(cur, cheapest.k)!;
  }
}

/** Standings: points desc, then money earned desc, then slot. */
export function standings(series: Series): Driver[] {
  return series.drivers.slice().sort((a, b) => b.points - a.points || b.earned - a.earned || a.slot - b.slot);
}
