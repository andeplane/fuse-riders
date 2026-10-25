/**
 * One match's world: plain integer records in flat arrays, so the netcode can checkpoint and hash it (`codec.ts`)
 * and `step` copies the (small) arrays and records and leaves the map out. What never changes — terrain,
 * sectors, flags and building sites — lives in the `GameMap`, which every peer loads identically.
 */
import type { GameMap, Site } from "./map.js";
import { div } from "./math.js";
import { NO_COOLDOWNS, NO_ITEMS } from "./items.js";
import type { Order } from "./orders.js";
import type { SpellEffect } from "./spells.js";
import { laneOwner } from "./waves.js";
import {
  BUILDING_HP,
  FACTORY_KINDS,
  GOLD,
  HERO,
  HEROES,
  TILE,
  TOWER,
  MAX_SEATS,
  UNIT_CAP,
  UNIT_CAP_BASE,
  UNIT_CAP_PER_SECTOR,
  teamOf,
  type BuildingKind,
  type HeroKind,
  type UnitKind,
} from "./tuning.js";

export interface Player {
  seat: number;
  team: number;
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
  /**
   * A lane tower's target (`towers.ts`): its `MARKS` index (a unit or a hero; -1 for none) and id, and the shots in a
   * row it has landed on it. -1, -1 and 0 for any other building.
   */
  aimOf: number;
  aim: number;
  ramp: number;
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
  /**
   * A wave unit's lane index (`GameMap.lanes`) and the wave number its hit points and damage grow by (`waves.ts`):
   * its wave's, plus `RAZE_WAVES` for each enemy structure its team had brought down when it spawned. -1 and 0 for
   * any other unit.
   */
  lane: number;
  wave: number;
}

/**
 * A player's hero (`hero.ts`): sub-pixels, hit points (0 while dead), energy, total XP (its level is `levelOf(xp)`),
 * steps to its next shot, steps until it respawns (0 while alive), the `DIRS` index (`flow.ts`) it last walked or
 * shot toward, the tile `move` sent it to (or -1), and the held `steer` direction ((0, 0) when released).
 */
export interface Hero {
  seat: number;
  kind: HeroKind;
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
  /** Steps since it last shot or was hit, up to `HERO.calm`; a calm hero regenerates (`tendHeroes`). */
  quiet: number;
  /** Steps left under Vix's CLOAK and Tally's BLITZ (`spells.ts`); 0 when not, and always 0 for another kit. */
  cloak: number;
  blitz: number;
  /** Tally's FLARE: the tile it marks (or -1) and the steps it has left (0 exactly when there is none). */
  flare: number;
  flareLeft: number;
  /**
   * The enemy `attack` told it to shoot (`focus.ts`): its `MARKS` index (-1 for none) and id, and the steps in a row it
   * has been out of range. While it has one, `goal` is the tile it chases toward.
   */
  focusOf: number;
  focus: number;
  lost: number;
  /** 1 while its `goal` is an attack-move: it stands to fight whatever comes in range on the way. */
  sweep: number;
  /** Shift-clicked orders waiting behind the current one (`orders.ts`), at most `QUEUE_MAX`; never mutated in place. */
  queue: readonly Order[];
  /** Steps the queue's first order, a cast, has waited to be castable; 0 otherwise. */
  wait: number;
  /** The player's gold (`gold.ts`), up to `GOLD.max`, and the heroes it has killed since it last fell. */
  gold: number;
  streak: number;
  /** By seat: steps left in which that seat's hero counts as having hit this one, for assists; never mutated in place. */
  hurt: readonly number[];
  /**
   * Its inventory by slot (`items.ts`): an `ITEMS` id, or -1 for an empty slot; each slot's steps until its active is
   * ready again; and the steps left under an Aegis SHIELD. Neither list is mutated in place.
   */
  items: readonly number[];
  itemCooldowns: readonly number[];
  shield: number;
}

/** What a `focus` (and an aimed spell's target) can be: by index, a unit (id), a hero (seat) or a building (site id). */
export const MARKS = ["unit", "hero", "building"] as const;

/** Vix's STICKY MINE: where it lies (or rides), the steps it has left, and the unit it stuck to (-1 while armed). */
export interface Mine {
  owner: number;
  x: number;
  y: number;
  life: number;
  stuck: number;
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
  /** Laid in order; at most `MINES_PER_HERO` a seat (`spells.ts`). */
  mines: Mine[];
  /** By flag index: steps left under Rivet's FORTIFY FLAG (it cannot change hands), 0 when not. */
  fortified: number[];
  /** By team: steps left under Rivet's OVERCLOCK (its factories build twice as fast). */
  overclock: number[];
  /** By camp (`GameMap.camps`): steps until its guards stand again, held at `CAMP_RESPAWN` while any stands (`jungle.ts`). */
  camps: number[];
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
      /** Where it landed, for its look: what it struck, mended or took; the mine, flare, flag or drop; DASH's start. */
      toX: number;
      toY: number;
    }
  /** A flag changed hands; none is announced when a cloaked hero took it. */
  | { type: "capture"; sector: number; seat: number }
  /** A hero used an item's active from `slot` (`shop.ts`): where it stood, and where it went (a BLINK) or stays. */
  | {
      type: "item";
      seat: number;
      slot: number;
      item: number;
      x: number;
      y: number;
      toX: number;
      toY: number;
    }
  /** A STICKY MINE went off on the tank it rode. */
  | { type: "mine"; seat: number; x: number; y: number }
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
  /** Each seat's hero, by seat; Brick when absent. */
  kinds: Readonly<Record<number, HeroKind>> = {},
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
    })),
    sectors,
    buildings: map.sites
      .filter((site) => site.kind !== "fort" || playing.includes(site.seat))
      .map((site) => ({
        id: site.id,
        hp: siteHp(site),
        order: defaultOrder(site.kind),
        progress: 0,
        cooldown: 0,
        aimOf: -1,
        aim: -1,
        ramp: 0,
      })),
    units: [],
    heroes: playing.map((seat) => freshHero(map, seat, kinds[seat])),
    mines: [],
    fortified: map.flags.map(() => 0),
    overclock: [0, 0],
    // Every camp's guards stand on the first step.
    camps: map.camps.map(() => 1),
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
export function freshHero(
  map: GameMap,
  seat: number,
  kind: HeroKind = "brick",
): Hero {
  const fort = fortSite(map, seat);
  return {
    seat,
    kind,
    x: fort.x * TILE + TILE / 2,
    y: fort.y * TILE + TILE / 2,
    hp: HEROES[kind].hp,
    energy: HERO.energy,
    xp: 0,
    cooldown: 0,
    respawn: 0,
    facing: 0,
    goal: -1,
    steerX: 0,
    steerY: 0,
    spells: [0, 0, 0, 0],
    quiet: HERO.calm,
    cloak: 0,
    blitz: 0,
    flare: -1,
    flareLeft: 0,
    focusOf: -1,
    focus: -1,
    lost: 0,
    sweep: 0,
    queue: [],
    wait: 0,
    gold: GOLD.start,
    streak: 0,
    hurt: NO_HURT,
    items: NO_ITEMS,
    itemCooldowns: NO_COOLDOWNS,
    shield: 0,
  };
}

/** Nobody's hit a hero lately. */
export const NO_HURT: readonly number[] = Object.freeze(
  Array.from({ length: MAX_SEATS }, () => 0),
);

/**
 * The seat that owns a building: a fort's seat, a lane structure's lane player (`laneOwner`, -1 when its team has
 * none in play), else whoever holds its sector (-1 when neutral).
 */
export function ownerOf(
  map: GameMap,
  world: World,
  building: Building,
): number {
  const site = map.sites[building.id]!;
  if (site.kind === "fort") return site.seat;
  if (site.lane >= 0) return laneOwner(map, world, site.team, site.lane);
  return world.sectors[site.sector]!;
}

/** A site's full hit points: a lane structure's by its tier (`TOWER`), else its kind's. */
export const siteHp = (site: Readonly<Site>): number =>
  site.lane >= 0 ? TOWER.hp[site.tier]! : BUILDING_HP[site.kind];

/** Sectors held by a team. */
export function teamSectors(world: World, team: number): number {
  let count = 0;
  for (const owner of world.sectors)
    if (owner !== NEUTRAL && teamOf(owner) === team) count++;
  return count;
}

/** The units `seat`'s factories build up to: a base plus its share of its team's sectors (`UNIT_CAP_BASE`). */
export function unitCap(world: World, seat: number): number {
  const team = teamOf(seat);
  let players = 0;
  for (const player of world.players) if (player.team === team) players++;
  const share = div(UNIT_CAP_PER_SECTOR * teamSectors(world, team), players);
  const cap = UNIT_CAP_BASE + share;
  return cap < UNIT_CAP ? cap : UNIT_CAP;
}
