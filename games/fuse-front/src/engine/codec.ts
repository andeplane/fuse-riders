/**
 * The world as checkpoint fields: nested integer tuples in a fixed order, so `JSON.stringify(encodeWorld(world))` is
 * canonical and `hashWorld` folds it with FNV-1a. A step's presentation `events` are left out. `decodeWorld` checks every field's type and range against the map
 * and the rules, then the invariants that span records, and returns a whole new world or nothing: a bad checkpoint is
 * refused without touching anything.
 */
import { sectorAt, type GameMap } from "./map.js";
import { DIRS, openTile } from "./flow.js";
import { MAX_XP, levelOf, maxEnergy, maxHp, respawnSteps } from "./hero.js";
import { div } from "./math.js";
import { FLARE, FOLLOW_HERO, isGoalTile } from "./move.js";
import {
  DROP_HP,
  KITS,
  MINES_PER_HERO,
  MINE_FUSE,
  kitHas,
  longest,
  type SpellEffect,
} from "./spells.js";
import { fnv1a } from "./rng.js";
import {
  BUILDING_HP,
  FACTORY_KINDS,
  FORT_GUN,
  MAX_SEATS,
  STANCES,
  HERO,
  HERO_KINDS,
  STEER_MAX,
  TILE,
  TURRET,
  UNITS,
  UNIT_CAP,
  UNIT_KINDS,
  teamOf,
} from "./tuning.js";
import {
  NEUTRAL,
  type Building,
  type Hero,
  type Mine,
  type Player,
  type Unit,
  type World,
  winnerOf,
} from "./world.js";

const UINT32 = 0xffff_ffff;
/** Steps, ids and counters stay well inside exact integers. */
const COUNT = 0xff_ffff_ffff;

export const isInt = (
  value: unknown,
  low: number,
  high: number,
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;

const tuple = (raw: unknown, length: number): unknown[] | undefined =>
  Array.isArray(raw) && raw.length === length ? raw : undefined;

export function encodeWorld(world: World): unknown {
  return [
    world.step,
    world.rng,
    world.nextId,
    world.players.map((p) => [p.seat, p.team, STANCES.indexOf(p.stance)]),
    [...world.sectors],
    world.buildings.map((b) => [
      b.id,
      b.hp,
      b.order === null ? -1 : UNIT_KINDS.indexOf(b.order),
      b.progress,
      b.cooldown,
    ]),
    world.units.map((u) => [
      u.id,
      UNIT_KINDS.indexOf(u.kind),
      u.owner,
      u.x,
      u.y,
      u.hp,
      u.cooldown,
      u.goal,
      u.stun,
      u.rally,
    ]),
    world.heroes.map((h) => [
      h.seat,
      h.x,
      h.y,
      h.hp,
      h.energy,
      h.xp,
      h.cooldown,
      h.respawn,
      h.facing,
      h.goal,
      h.steerX,
      h.steerY,
      [...h.spells],
      h.quiet,
      HERO_KINDS.indexOf(h.kind),
      h.cloak,
      h.blitz,
      h.flare,
      h.flareLeft,
    ]),
    world.winner,
    world.mines.map((m) => [m.owner, m.x, m.y, m.life, m.stuck]),
    [...world.fortified],
    [...world.overclock],
  ];
}

/** FNV-1a over the canonical encoding, as 8 hex digits. */
export const hashWorld = (world: World): string =>
  fnv1a(JSON.stringify(encodeWorld(world)))
    .toString(16)
    .padStart(8, "0");

function player(raw: unknown): Player | undefined {
  const t = tuple(raw, 3);
  if (!t) return;
  const [seat, team, stance] = t;
  if (!isInt(seat, 0, MAX_SEATS - 1) || team !== teamOf(seat)) return;
  if (!isInt(stance, 0, STANCES.length - 1)) return;
  return { seat, team, stance: STANCES[stance]! };
}

function building(raw: unknown, map: GameMap): Building | undefined {
  const t = tuple(raw, 5);
  if (!t) return;
  const [id, hp, order, progress, cooldown] = t;
  if (!isInt(id, 0, map.sites.length - 1)) return;
  const kind = map.sites[id]!.kind;
  // Only turrets and forts are shot at, so only they can stand at 0 hit points (a ruin).
  const lowest = kind === "turret" || kind === "fort" ? 0 : 1;
  if (!isInt(hp, lowest, BUILDING_HP[kind])) return;
  // Standing turrets and forts reload their guns; nothing else has one.
  const gun =
    hp === 0
      ? 0
      : kind === "turret"
        ? TURRET.cooldown
        : kind === "fort"
          ? FORT_GUN.cooldown
          : 0;
  if (!isInt(cooldown, 0, gun)) return;
  const kinds = FACTORY_KINDS[kind];
  if (
    kinds.length === 0 ? order !== -1 : !isInt(order, 0, UNIT_KINDS.length - 1)
  )
    return;
  const made = order === -1 ? null : UNIT_KINDS[order as number]!;
  if (made !== null && !kinds.includes(made)) return;
  // A batch resets on completion, so stored work stays below a whole batch.
  const most = made === null ? 0 : UNITS[made].build * 100 - 1;
  if (!isInt(progress, 0, most)) return;
  return { id, hp, order: made, progress, cooldown };
}

function unit(raw: unknown, map: GameMap): Unit | undefined {
  const t = tuple(raw, 10);
  if (!t) return;
  const [id, kind, owner, x, y, hp, cooldown, goal, stun, rally] = t;
  if (!isInt(id, 1, COUNT) || !isInt(kind, 0, UNIT_KINDS.length - 1)) return;
  const stats = UNITS[UNIT_KINDS[kind]!];
  if (!isInt(owner, 0, MAX_SEATS - 1)) return;
  if (!isInt(x, 0, map.width * TILE - 1) || !isInt(y, 0, map.height * TILE - 1))
    return;
  // An Orbital Drop tank lands tougher than a factory's.
  const most = UNIT_KINDS[kind] === "lightTank" ? DROP_HP : stats.hp;
  if (!isInt(hp, 1, most) || !isInt(cooldown, 0, stats.cooldown)) return;
  // Units stand on ground something walks on, never in rock or water.
  if (sectorAt(map, div(x, TILE), div(y, TILE)) < 0) return;
  // A goal is a flag or fort tile, or -1 for none yet: a few dozen tiles, so their flow fields stay cached.
  if (
    goal !== -1 &&
    goal !== FOLLOW_HERO &&
    !(goal === FLARE && stats.robot) &&
    !(isInt(goal, 0, COUNT) && isGoalTile(map, goal))
  )
    return;
  // Only robots take statuses, and none outlasts its spell at the top level.
  const robot = stats.robot ? 1 : 0;
  if (!isInt(stun, 0, robot * longest("shockwave"))) return;
  if (!isInt(rally, 0, robot * longest("rally"))) return;
  const unitKind = UNIT_KINDS[kind]!;
  return { id, kind: unitKind, owner, x, y, hp, cooldown, goal, stun, rally };
}

function hero(raw: unknown, map: GameMap): Hero | undefined {
  const t = tuple(raw, 19);
  if (!t) return;
  const [seat, x, y, hp, energy, xp, cooldown, respawn, facing, goal] = t;
  const [steerX, steerY, quiet] = [t[10], t[11], t[13]];
  const [kindIndex, cloak, blitz, flare, flareLeft] = t.slice(14);
  if (!isInt(kindIndex, 0, HERO_KINDS.length - 1)) return;
  const kind = HERO_KINDS[kindIndex]!;
  // A status only its own kit casts, never on a dead hero; a flare marks an open tile exactly while it burns.
  const most = (effect: SpellEffect) =>
    kitHas(kind, effect) && hp !== 0 ? longest(effect) : 0;
  if (!isInt(cloak, 0, most("cloak")) || !isInt(blitz, 0, most("blitz")))
    return;
  if (!isInt(flareLeft, 0, most("flare"))) return;
  if (flareLeft === 0 ? flare !== -1 : !isInt(flare, 0, COUNT)) return;
  const marked = flare as number;
  if (
    marked !== -1 &&
    !openTile(map, marked % map.width, div(marked, map.width))
  )
    return;
  // Steps since it last fought, counted up to calm.
  if (!isInt(quiet, 0, HERO.calm)) return;
  if (!isInt(seat, 0, MAX_SEATS - 1) || !isInt(xp, 0, MAX_XP)) return;
  const level = levelOf(xp);
  if (!isInt(x, 0, map.width * TILE - 1) || !isInt(y, 0, map.height * TILE - 1))
    return;
  if (!openTile(map, div(x, TILE), div(y, TILE))) return;
  if (!isInt(hp, 0, maxHp(level, kind)) || !isInt(energy, 0, maxEnergy(level)))
    return;
  // A living hero has no respawn timer; a dead one has one running and its gun at rest.
  if (hp > 0 ? respawn !== 0 : !isInt(respawn, 1, respawnSteps(level))) return;
  if (!isInt(cooldown, 0, hp > 0 ? HERO.cooldown : 0)) return;
  if (!isInt(facing, 0, DIRS.length - 1)) return;
  // A move goal is any open tile, at most one per hero, so the flow cache stays bounded.
  if (goal !== -1) {
    if (!isInt(goal, 0, map.width * map.height - 1)) return;
    if (!openTile(map, goal % map.width, div(goal, map.width))) return;
  }
  if (!isInt(steerX, -STEER_MAX, STEER_MAX)) return;
  if (!isInt(steerY, -STEER_MAX, STEER_MAX)) return;
  // One cooldown per slot, never above the slot's own (a passive's is 0).
  const kit = KITS[kind];
  const spells = tuple(t[12], kit.length);
  if (!spells?.every((left, slot) => isInt(left, 0, kit[slot]!.cooldown)))
    return;
  // A held stick cancels a move, and a move releases the stick, so a hero never has both.
  if (goal !== -1 && (steerX !== 0 || steerY !== 0)) return;
  return {
    seat,
    x,
    y,
    hp,
    energy,
    xp,
    cooldown,
    respawn: respawn as number,
    facing,
    goal: goal as number,
    steerX,
    steerY,
    spells: spells as number[],
    quiet,
    kind,
    cloak,
    blitz,
    flare: marked,
    flareLeft,
  };
}

/** A mine of one of `layers`' seats, on walkable ground, with life left: up to a fuse once stuck to a unit id. */
function mine(
  raw: unknown,
  map: GameMap,
  layers: ReadonlySet<number>,
  nextId: number,
): Mine | undefined {
  const t = tuple(raw, 5);
  if (!t) return;
  const [owner, x, y, life, stuck] = t;
  if (!isInt(owner, 0, MAX_SEATS - 1) || !layers.has(owner)) return;
  if (!isInt(x, 0, map.width * TILE - 1) || !isInt(y, 0, map.height * TILE - 1))
    return;
  if (sectorAt(map, div(x, TILE), div(y, TILE)) < 0) return;
  if (!isInt(stuck, -1, nextId - 1) || stuck === 0) return;
  if (!isInt(life, 1, stuck < 0 ? longest("stickyMine") : MINE_FUSE)) return;
  return { owner, x, y, life, stuck };
}

function list<T>(
  raw: unknown,
  max: number,
  item: (each: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(raw) || raw.length > max) return;
  const out: T[] = [];
  for (const each of raw) {
    const value = item(each);
    if (value === undefined) return;
    out.push(value);
  }
  return out;
}

const ascending = <T>(items: readonly T[], key: (item: T) => number) =>
  items.every(
    (item, index) => index === 0 || key(item) > key(items[index - 1]!),
  );

/** A world from a checkpoint for `map`, or undefined when anything in it is out of place. */
export function decodeWorld(raw: unknown, map: GameMap): World | undefined {
  const t = tuple(raw, 12);
  if (!t) return;
  const [step, rng, nextId, rawPlayers, rawSectors, rawBuildings, rawUnits] = t;
  const [rawHeroes, winner, rawMines, rawFortified, rawOverclock] = t.slice(7);
  if (
    !isInt(step, 0, COUNT) ||
    !isInt(rng, 0, UINT32) ||
    !isInt(nextId, 1, COUNT)
  )
    return;
  const players = list(rawPlayers, MAX_SEATS, player);
  if (!players || players.length < 2 || !ascending(players, (p) => p.seat))
    return;
  const seats = new Set(players.map((p) => p.seat));
  // Every seat in play has a fort on this map, as `createWorld` requires.
  for (const seat of seats)
    if (!map.sites.some((site) => site.kind === "fort" && site.seat === seat))
      return;
  const sectors = list(rawSectors, map.flags.length, (each) =>
    each === NEUTRAL || (isInt(each, 0, MAX_SEATS - 1) && seats.has(each))
      ? (each as number)
      : undefined,
  );
  if (!sectors || sectors.length !== map.flags.length) return;
  const buildings = list(rawBuildings, map.sites.length, (each) =>
    building(each, map),
  );
  if (!buildings || !ascending(buildings, (b) => b.id)) return;
  // Exactly the map's buildings and the forts of the seats in play.
  const expected = map.sites.filter(
    (site) => site.kind !== "fort" || seats.has(site.seat),
  );
  if (
    buildings.length !== expected.length ||
    buildings.some((b, index) => b.id !== expected[index]!.id)
  )
    return;
  const units = list(rawUnits, MAX_SEATS * UNIT_CAP, (each) => unit(each, map));
  if (!units || !ascending(units, (u) => u.id)) return;
  const owned = new Map<number, number>();
  for (const u of units) {
    if (!seats.has(u.owner) || u.id >= nextId) return;
    owned.set(u.owner, (owned.get(u.owner) ?? 0) + 1);
  }
  for (const count of owned.values()) if (count > UNIT_CAP) return;
  // One hero per player, in the players' order.
  const heroes = list(rawHeroes, MAX_SEATS, (each) => hero(each, map));
  if (
    !heroes ||
    heroes.length !== players.length ||
    heroes.some((h, index) => h.seat !== players[index]!.seat)
  )
    return;
  // The recorded result is exactly the one the forts imply.
  const result = winnerOf(map, players, buildings);
  if (winner !== result) return;
  // Mines belong to a player whose kit lays them, a few each; FORTIFY and OVERCLOCK timers never outlast the spell.
  const layers = new Set(
    heroes.filter((h) => kitHas(h.kind, "stickyMine")).map((h) => h.seat),
  );
  const mines = list(rawMines, MAX_SEATS * MINES_PER_HERO, (each) =>
    mine(each, map, layers, nextId),
  );
  if (!mines) return;
  for (const seat of layers)
    if (mines.filter((m) => m.owner === seat).length > MINES_PER_HERO) return;
  const timer = (most: number) => (each: unknown) =>
    isInt(each, 0, most) ? each : undefined;
  const fortified = list(
    rawFortified,
    map.flags.length,
    timer(longest("fortify")),
  );
  const overclock = list(rawOverclock, 2, timer(longest("overclock")));
  if (fortified?.length !== map.flags.length || overclock?.length !== 2) return;
  return {
    step,
    rng,
    nextId,
    players,
    sectors,
    buildings,
    units,
    heroes,
    mines,
    fortified,
    overclock,
    winner: result,
    events: [],
  };
}
