/**
 * One match's world: plain integer records in flat arrays, so the netcode can checkpoint and hash it (`codec.ts`)
 * and `step` copies the (small) arrays and records and leaves the map out. What never changes — terrain,
 * sectors, flags and building sites — lives in the `GameMap`, which every peer loads identically.
 */
import type { GameMap, Site } from "./map.js";
import type { SpellEffect } from "./spells.js";
import {
  BUILDING_HP,
  FACTORY_KINDS,
  HERO,
  TILE,
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
  /** A turret's steps until its next shot; 0 for anything else. */
  cooldown: number;
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
  /** The tile index (`y * width + x`) the unit's stance sends it to, or -1 until it picks one (`move.ts`). */
  goal: number;
  /** Steps left stunned by SHOCKWAVE and rallied by RALLY CRY (`spells.ts`); 0 when not. */
  stun: number;
  rally: number;
}

/**
 * A player's hero (`hero.ts`): sub-pixels, hit points (0 while dead), energy, total XP (its level is `levelOf(xp)`),
 * steps to its next shot, steps until it respawns (0 while alive), the `DIRS` index (`flow.ts`) it last walked or
 * shot toward, the tile `move` sent it to (or -1), and the held `steer` direction ((0, 0) when released).
 */
export interface Hero {
  seat: number;
  x: number;
  y: number;
  hp: number;
  energy: number;
  xp: number;
  cooldown: number;
  respawn: number;
  facing: number;
  goal: number;
  steerX: number;
  steerY: number;
  /** Steps until each slot (`spells.ts`) can be cast again. */
  spells: number[];
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
  /** One per player, by seat ascending. */
  heroes: Hero[];
  /** `NO_WINNER` while the match runs, then the winning team or `DRAW` (`winnerOf`). */
  winner: number;
  /**
   * What the last step (or tick) did, for presentation only: never encoded or hashed, empty after a decode, and
   * rebuilt by every step, so it is bounded by one tick's shots, deaths and ruins.
   */
  events: CombatEvent[];
}

/** One end of a shot: a unit, a hero (its id is its seat) or a building (turret or fort), and where it stood. */
export interface Mark {
  of: "unit" | "hero" | "building";
  id: number;
  x: number;
  y: number;
}

/** Shots are instant hits, so a `shot` is also its hit. */
export type CombatEvent =
  | { type: "shot"; from: Mark; to: Mark; damage: number }
  | {
      type: "death";
      id: number;
      kind: UnitKind;
      owner: number;
      x: number;
      y: number;
    }
  | { type: "destroyed"; building: number; kind: BuildingKind }
  /** `killer` is the seat credited with the kill. */
  | { type: "heroDeath"; seat: number; killer: number; x: number; y: number }
  | { type: "respawn"; seat: number; x: number; y: number }
  | { type: "levelUp"; seat: number; level: number }
  | {
      type: "cast";
      seat: number;
      slot: number;
      effect: SpellEffect;
      x: number;
      y: number;
    }
  | { type: "won"; winner: number };

export const NEUTRAL = -1;
export const NO_WINNER = -1;
/** Every team in play lost its last fort on the same step. */
export const DRAW = 2;

/**
 * The match result the buildings imply: with two or more teams in play, the one team with a fort standing wins, or
 * nobody when none has; otherwise the match runs on. A destroyed fort or turret keeps its record at 0 hit points.
 */
export function winnerOf(
  map: GameMap,
  players: readonly Player[],
  buildings: readonly Building[],
): number {
  const teams = new Set(players.map((player) => player.team));
  const standing = new Set<number>();
  for (const building of buildings) {
    const site = map.sites[building.id]!;
    if (site.kind === "fort" && building.hp > 0)
      standing.add(teamOf(site.seat));
  }
  if (teams.size < 2 || standing.size > 1) return NO_WINNER;
  return standing.size === 1 ? [...standing][0]! : DRAW;
}

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
    sectors[fortSite(map, seat).sector] = seat;
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
        cooldown: 0,
      })),
    units: [],
    heroes: playing.map((seat) => freshHero(map, seat)),
    winner: NO_WINNER,
    events: [],
  };
}

/** A seat's fort site; throws when the map has none (`createWorld` and `decodeWorld` require one per seat). */
export function fortSite(map: GameMap, seat: number): Readonly<Site> {
  const fort = map.sites.find(
    (site) => site.kind === "fort" && site.seat === seat,
  );
  if (fort === undefined)
    throw new Error(`${map.name} has no fort for seat ${seat}`);
  return fort;
}

/** A level 1 hero standing on its fort's tile (forts stand on open ground). */
export function freshHero(map: GameMap, seat: number): Hero {
  const fort = fortSite(map, seat);
  return {
    seat,
    x: fort.x * TILE + TILE / 2,
    y: fort.y * TILE + TILE / 2,
    hp: HERO.hp,
    energy: HERO.energy,
    xp: 0,
    cooldown: 0,
    respawn: 0,
    facing: 0,
    goal: -1,
    steerX: 0,
    steerY: 0,
    spells: [0, 0, 0, 0],
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
