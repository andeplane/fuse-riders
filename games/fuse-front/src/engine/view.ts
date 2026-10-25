/**
 * What the renderer reads: the map's terrain and sectors with the world's owners, flags, buildings with their build
 * progress, and units. It is built fresh from a map and world and shares no mutable record with either, so a renderer
 * can never write back into the simulation.
 */
import type { Biome, GameMap, Lane, Tile } from "./map.js";
import { levelOf, maxEnergy, maxHp } from "./hero.js";
import { div } from "./math.js";
import { centreOf } from "./move.js";
import {
  BUILDING_HP,
  UNITS,
  teamOf,
  type BuildingKind,
  type HeroKind,
  type UnitKind,
} from "./tuning.js";
import { heroTarget, type Aim } from "./focus.js";
import { KITS, hideOf, unitMax, type Spell } from "./spells.js";
import {
  NEUTRAL,
  ownerOf,
  siteHp,
  unitCap,
  type CombatEvent,
  type Hero,
  type World,
} from "./world.js";

/** What the renderer needs besides the view itself, so it never reaches past this file into the engine. */
export { SUB, TILE_PX } from "./tuning.js";
export type { BuildingKind, HeroKind, UnitKind } from "./tuning.js";
export type { CombatEvent, Mark } from "./world.js";

export interface FlagView {
  sector: number;
  x: number;
  y: number;
  /** Seat, or -1 for neutral. */
  owner: number;
  /** Team, or -1 for neutral. */
  team: number;
  /** Under Rivet's FORTIFY FLAG: it cannot change hands. */
  fortified: boolean;
}

export interface BuildingView {
  id: number;
  kind: BuildingKind;
  /** Tiles. */
  x: number;
  y: number;
  sector: number;
  owner: number;
  team: number;
  hp: number;
  maxHp: number;
  order: UnitKind | null;
  /** The current batch's progress in thousandths. */
  progress: number;
}

export interface UnitView {
  id: number;
  kind: UnitKind;
  owner: number;
  team: number;
  /** Sub-pixels. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Under SHOCKWAVE's stun or RALLY CRY's boost this step. */
  stunned: boolean;
  rallied: boolean;
  /** Inside an enemy Tally's SPOTTER radius: it takes extra damage. */
  spotted: boolean;
}

export interface HeroView {
  seat: number;
  /** Which hero it is, for its model, portrait and spell icons. */
  kind: HeroKind;
  team: number;
  /** Sub-pixels. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  respawn: number;
  energy: number;
  maxEnergy: number;
  xp: number;
  /** Its player's gold (`gold.ts`). */
  gold: number;
  /** Steps until each spell slot can be cast again. */
  spells: readonly number[];
  /** Under its own CLOAK or BLITZ; the tile its FLARE marks, or -1. */
  cloaked: boolean;
  blitzing: boolean;
  flare: number;
  /**
   * What it shoots (`focus.ts`): the enemy `attack` chose for it (`chosen`), else the one its gun picks next from
   * where everything stands; null when it has none or is dead. Sub-pixels; a building's `id` is its site id.
   */
  target: TargetView | null;
  /** Its spells by slot (the shared, frozen table), for tooltips and aiming. */
  kit: readonly SpellInfo[];
  /**
   * Its route (`orders.ts`): the current order, if it has one (`current`), then its queued orders, each where it
   * leads in sub-pixels: a tile's centre, an attack's target where it stands (one gone is left out) and a cast's aim
   * tile, or its chosen target's spot while that stands.
   */
  route: readonly RouteStop[];
}

export interface RouteStop {
  kind: "move" | "attackMove" | "attack" | "cast";
  x: number;
  y: number;
  current: boolean;
  /** A cast's slot; -1 otherwise. */
  slot: number;
}

export type TargetView = Aim & { chosen: boolean };

/** A spell as the HUD explains it (`spells.ts`): aiming, reach and area in sub-pixels, cost, cooldown in steps, unlock. */
export type SpellInfo = Pick<
  Spell,
  | "name"
  | "desc"
  | "targeting"
  | "passive"
  | "range"
  | "radius"
  | "energy"
  | "cooldown"
  | "unlock"
>;

/** Every kit's spells, by hero kind and slot: the engine's frozen table, so a view can share it. */
export const SPELL_INFO: Readonly<Record<HeroKind, readonly SpellInfo[]>> =
  KITS;

export interface WorldView {
  step: number;
  /** How the map's ground looks (the renderers' palette); the rules never read it. */
  biome: Biome;
  width: number;
  height: number;
  /** The map's rows (shared and frozen). */
  terrain: readonly string[];
  /** Per tile: its sector, or -1 (shared and frozen). */
  sectorOf: readonly number[];
  /** By sector: its owning seat, or -1. */
  sectorOwners: readonly number[];
  flags: readonly FlagView[];
  /** A lane map's lanes with their tower and gate slots, and its neutral camp slots, in tiles (shared and frozen). */
  lanes: readonly Readonly<Lane>[];
  camps: readonly Readonly<Tile>[];
  buildings: readonly BuildingView[];
  units: readonly UnitView[];
  /** `unitCap`: the units the player's factories build up to, from the team's sectors. */
  players: readonly {
    seat: number;
    team: number;
    unitCap: number;
  }[];
  /** One per seat in play; `hp` is 0 while it waits `respawn` steps at its fort. */
  heroes: readonly HeroView[];
  /** Vix's STICKY MINEs, in sub-pixels; `stuck` once one rides a tank. */
  mines: readonly {
    owner: number;
    team: number;
    x: number;
    y: number;
    stuck: boolean;
  }[];
  /** `NO_WINNER`, the winning team, or `DRAW`. */
  winner: number;
  /** What the last step or tick did (shots, deaths, ruins, the result), to animate; not part of the checkpoint. */
  events: readonly CombatEvent[];
}

/** Where a target stands now (`MARKS` index and id), friend or foe, for drawing a route; undefined once gone. */
function spotOf(
  map: GameMap,
  world: World,
  of: number,
  id: number,
): { x: number; y: number } | undefined {
  if (of === 0) return world.units.find((each) => each.id === id);
  if (of === 1) {
    const hero = world.heroes.find((each) => each.seat === id);
    return hero && hero.hp > 0 ? hero : undefined;
  }
  const site = map.sites[id];
  return site && { x: centreOf(site.x), y: centreOf(site.y) };
}

function routeOf(map: GameMap, world: World, hero: Hero): RouteStop[] {
  const route: RouteStop[] = [];
  const centre = (x: number, y: number) => ({ x: centreOf(x), y: centreOf(y) });
  const focus = heroTarget(map, world, hero);
  if (focus?.chosen)
    route.push({
      kind: "attack",
      x: focus.x,
      y: focus.y,
      current: true,
      slot: -1,
    });
  else if (hero.goal >= 0)
    route.push({
      kind: hero.sweep > 0 ? "attackMove" : "move",
      ...centre(hero.goal % map.width, div(hero.goal, map.width)),
      current: true,
      slot: -1,
    });
  for (const order of hero.queue) {
    const at =
      order.type === "attack"
        ? spotOf(map, world, order.of, order.id)
        : order.type === "cast" && order.of >= 0
          ? (spotOf(map, world, order.of, order.id) ?? centre(order.x, order.y))
          : centre(order.x, order.y);
    if (at === undefined) continue;
    const slot = order.type === "cast" ? order.slot : -1;
    route.push({ kind: order.type, x: at.x, y: at.y, current: false, slot });
  }
  return route;
}

const teamOrNeutral = (seat: number): number =>
  seat === NEUTRAL ? NEUTRAL : teamOf(seat);

export function viewOf(map: GameMap, world: World): WorldView {
  return {
    step: world.step,
    biome: map.biome,
    width: map.width,
    height: map.height,
    terrain: map.terrain,
    sectorOf: map.sectorOf,
    sectorOwners: [...world.sectors],
    lanes: map.lanes,
    camps: map.camps,
    flags: map.flags.map((flag, sector) => ({
      sector,
      x: flag.x,
      y: flag.y,
      owner: world.sectors[sector]!,
      team: teamOrNeutral(world.sectors[sector]!),
      fortified: world.fortified[sector]! > 0,
    })),
    buildings: world.buildings.map((building) => {
      const site = map.sites[building.id]!,
        owner = ownerOf(map, world, building);
      return {
        id: building.id,
        kind: site.kind,
        x: site.x,
        y: site.y,
        sector: site.sector,
        owner,
        team: teamOrNeutral(owner),
        hp: building.hp,
        maxHp: siteHp(site),
        order: building.order,
        progress:
          building.order === null
            ? 0
            : div(building.progress * 1000, UNITS[building.order].build * 100),
      };
    }),
    units: world.units.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      owner: unit.owner,
      team: teamOrNeutral(unit.owner),
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
      // A unit records no origin, so an Orbital Drop tank reads as one only while it is above a factory tank's most.
      maxHp: unitMax(unit),
      stunned: unit.stun > 0,
      rallied: unit.rally > 0,
      spotted: hideOf(world, unit, teamOf(unit.owner), true) > 0,
    })),
    players: world.players.map((player) => ({
      ...player,
      unitCap: unitCap(world, player.seat),
    })),
    heroes: world.heroes.map((hero) => ({
      seat: hero.seat,
      kind: hero.kind,
      team: teamOf(hero.seat),
      x: hero.x,
      y: hero.y,
      hp: hero.hp,
      maxHp: maxHp(levelOf(hero.xp), hero.kind),
      level: levelOf(hero.xp),
      respawn: hero.respawn,
      energy: hero.energy,
      maxEnergy: maxEnergy(levelOf(hero.xp)),
      xp: hero.xp,
      gold: hero.gold,
      spells: [...hero.spells],
      cloaked: hero.cloak > 0,
      blitzing: hero.blitz > 0,
      flare: hero.flare,
      target: heroTarget(map, world, hero),
      kit: SPELL_INFO[hero.kind],
      route: routeOf(map, world, hero),
    })),
    mines: world.mines.map((mine) => ({
      owner: mine.owner,
      team: teamOf(mine.owner),
      x: mine.x,
      y: mine.y,
      stuck: mine.stuck >= 0,
    })),
    winner: world.winner,
    events: structuredClone(world.events),
  };
}
