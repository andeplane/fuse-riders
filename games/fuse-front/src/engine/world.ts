/**
 * One match's world: plain integer records in flat arrays, so the netcode can checkpoint and hash it (`codec.ts`)
 * and `step` copies the (small) arrays and records and leaves the map out. What never changes — terrain,
 * sectors, flags and building sites — lives in the `GameMap`, which every peer loads identically.
 */
import type { GameMap } from "./map.js";
import {
  BUILDING_HP,
  FACTORY_KINDS,
  MAX_SEATS,
  teamOf,
  type BuildingKind,
  type Stance,
  type UnitKind,
} from "./tuning.js";

export interface Player {
  seat: number;
  team: number;
  stance: Stance;
}

/** The building on map site `id` (`GameMap.sites`); its owner is its sector's, except a fort's, which is its seat's. */
export interface Building {
  id: number;
  hp: number;
  /** What the factory builds on a loop; null for a turret or fort. */
  order: UnitKind | null;
  /** Work done toward the current batch, in clock units (`clockRate` per step, finishing at `build * 100`). */
  progress: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  owner: number;
  /** Sub-pixels. */
  x: number;
  y: number;
  hp: number;
  /** Steps until the next shot. */
  cooldown: number;
}

export interface World {
  step: number;
  /** mulberry32 state (`rng.ts`). */
  rng: number;
  /** The id the next unit gets. */
  nextId: number;
  /** By seat, ascending. */
  players: Player[];
  /** By flag index: the owning seat, or -1 for neutral. */
  sectors: number[];
  /** By site id, ascending: one per map building, plus the forts of seats in play. */
  buildings: Building[];
  /** By id, ascending. */
  units: Unit[];
}

export const NEUTRAL = -1;

/** A building kind's order when it is built or changes hands. */
export const defaultOrder = (kind: BuildingKind): UnitKind | null =>
  FACTORY_KINDS[kind][0] ?? null;

/**
 * A fresh match on `map` for the seats in play (each needs a fort on the map). Every fort's home sector starts owned
 * by its seat; every other sector starts neutral, and its factories idle until someone captures them.
 */
export function createWorld(
  map: GameMap,
  seats: readonly number[],
  seed: number,
): World {
  const playing = [...new Set(seats)].sort((a, b) => a - b);
  if (playing.length < 2 || playing.length !== seats.length)
    throw new Error("a match needs two or more distinct seats");
  const sectors = map.flags.map(() => NEUTRAL);
  for (const seat of playing) {
    if (seat < 0 || seat >= MAX_SEATS || !Number.isInteger(seat))
      throw new Error(`seat ${seat} is not 0 to ${MAX_SEATS - 1}`);
    const fort = map.sites.find(
      (site) => site.kind === "fort" && site.seat === seat,
    );
    if (fort === undefined)
      throw new Error(`${map.name} has no fort for seat ${seat}`);
    sectors[fort.sector] = seat;
  }
  return {
    step: 0,
    rng: seed >>> 0,
    nextId: 1,
    players: playing.map((seat) => ({
      seat,
      team: teamOf(seat),
      stance: "push",
    })),
    sectors,
    buildings: map.sites
      .filter((site) => site.kind !== "fort" || playing.includes(site.seat))
      .map((site) => ({
        id: site.id,
        hp: BUILDING_HP[site.kind],
        order: defaultOrder(site.kind),
        progress: 0,
      })),
    units: [],
  };
}

/** The seat that owns a building: a fort's seat, else whoever holds its sector (-1 when neutral). */
export function ownerOf(
  map: GameMap,
  world: World,
  building: Building,
): number {
  const site = map.sites[building.id]!;
  return site.kind === "fort" ? site.seat : world.sectors[site.sector]!;
}

/** Sectors held by a team. */
export function teamSectors(world: World, team: number): number {
  let count = 0;
  for (const owner of world.sectors)
    if (owner !== NEUTRAL && teamOf(owner) === team) count++;
  return count;
}
