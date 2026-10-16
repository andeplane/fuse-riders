/**
 * The world as checkpoint fields: nested integer tuples in a fixed order, so `JSON.stringify(encodeWorld(world))` is
 * canonical and `hashWorld` folds it with FNV-1a. `decodeWorld` checks every field's type and range against the map
 * and the rules, then the invariants that span records, and returns a whole new world or nothing: a bad checkpoint is
 * refused without touching anything.
 */
import { sectorAt, type GameMap } from "./map.js";
import { div } from "./math.js";
import { fnv1a } from "./rng.js";
import {
  BUILDING_HP,
  FACTORY_KINDS,
  MAX_SEATS,
  STANCES,
  TILE,
  UNITS,
  UNIT_CAP,
  UNIT_KINDS,
  teamOf,
} from "./tuning.js";
import {
  NEUTRAL,
  type Building,
  type Player,
  type Unit,
  type World,
} from "./world.js";

const UINT32 = 0xffff_ffff;
/** Steps, ids and counters stay well inside exact integers. */
const COUNT = 0xff_ffff_ffff;

const isInt = (value: unknown, low: number, high: number): value is number =>
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
    ]),
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
  const t = tuple(raw, 4);
  if (!t) return;
  const [id, hp, order, progress] = t;
  if (!isInt(id, 0, map.sites.length - 1)) return;
  const kind = map.sites[id]!.kind;
  if (!isInt(hp, 0, BUILDING_HP[kind])) return;
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
  return { id, hp, order: made, progress };
}

function unit(raw: unknown, map: GameMap): Unit | undefined {
  const t = tuple(raw, 8);
  if (!t) return;
  const [id, kind, owner, x, y, hp, cooldown, goal] = t;
  if (!isInt(id, 1, COUNT) || !isInt(kind, 0, UNIT_KINDS.length - 1)) return;
  const stats = UNITS[UNIT_KINDS[kind]!];
  if (!isInt(owner, 0, MAX_SEATS - 1)) return;
  if (!isInt(x, 0, map.width * TILE - 1) || !isInt(y, 0, map.height * TILE - 1))
    return;
  if (!isInt(hp, 1, stats.hp) || !isInt(cooldown, 0, stats.cooldown)) return;
  // Units stand on ground something walks on, never in rock or water.
  if (sectorAt(map, div(x, TILE), div(y, TILE)) < 0) return;
  // A goal is a tile something walks on, or -1 for none yet.
  if (
    goal !== -1 &&
    !(isInt(goal, 0, map.width * map.height - 1) && map.sectorOf[goal]! >= 0)
  )
    return;
  return { id, kind: UNIT_KINDS[kind]!, owner, x, y, hp, cooldown, goal };
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
  const t = tuple(raw, 7);
  if (!t) return;
  const [step, rng, nextId, rawPlayers, rawSectors, rawBuildings, rawUnits] = t;
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
  return { step, rng, nextId, players, sectors, buildings, units };
}
