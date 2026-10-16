/**
 * One engine step: the step's commands, then capture, then production. `step` never mutates the world it is given:
 * it copies the arrays and records (players, sectors, buildings, units) and returns a new world, so the netcode can keep the previous
 * one as a snapshot. Movement, combat, heroes and bots arrive in later rules; units stand where they spawn.
 */
import { flagAt, type GameMap } from "./map.js";
import { div } from "./math.js";
import {
  COMMANDS_PER_SEAT,
  FACTORY_KINDS,
  STANCES,
  STEPS_PER_TICK,
  TILE,
  UNITS,
  UNIT_CAP,
  UNIT_KINDS,
  clockRate,
  teamOf,
  type Stance,
  type UnitKind,
} from "./tuning.js";
import {
  NEUTRAL,
  defaultOrder,
  ownerOf,
  teamSectors,
  type World,
} from "./world.js";

/** What a player sends: a factory's standing order, or the stance of every unit that player's factories built. */
export type Command =
  | { seat: number; type: "order"; factory: number; kind: UnitKind }
  | { seat: number; type: "stance"; stance: Stance };

/** The tile a sub-pixel coordinate lies on. */
export const tileOf = (sub: number): number => div(sub, TILE);
/** A tile's centre in sub-pixels. */
export const centreOf = (tile: number): number => tile * TILE + div(TILE, 2);

export function step(
  map: GameMap,
  world: World,
  commands: readonly Command[] = [],
): World {
  const next: World = {
    ...world,
    step: world.step + 1,
    players: world.players.map((player) => ({ ...player })),
    sectors: [...world.sectors],
    buildings: world.buildings.map((building) => ({ ...building })),
    units: world.units.map((unit) => ({ ...unit })),
  };
  applyCommands(map, next, commands);
  capture(map, next);
  produce(map, next);
  return next;
}

/** One 50 ms log tick: the tick's commands apply at its first step. */
export function stepTick(
  map: GameMap,
  world: World,
  commands: readonly Command[] = [],
): World {
  let next = world;
  for (let index = 0; index < STEPS_PER_TICK; index++)
    next = step(map, next, index === 0 ? commands : []);
  return next;
}

/**
 * Commands in the order given, each checked against the world (the log is trusted, but a stale order — a factory
 * lost since it was sent — must do nothing). Past `COMMANDS_PER_SEAT` a seat's commands are dropped.
 */
function applyCommands(
  map: GameMap,
  world: World,
  commands: readonly Command[],
): void {
  const used = new Map<number, number>();
  for (const command of commands) {
    const player = world.players.find((each) => each.seat === command.seat);
    if (player === undefined) continue;
    const count = used.get(player.seat) ?? 0;
    if (count >= COMMANDS_PER_SEAT) continue;
    used.set(player.seat, count + 1);
    if (command.type === "stance") {
      if ((STANCES as readonly unknown[]).includes(command.stance))
        player.stance = command.stance;
    } else if (command.type === "order") {
      const building = world.buildings.find(
        (each) => each.id === command.factory,
      );
      if (building === undefined) continue;
      if (!(UNIT_KINDS as readonly unknown[]).includes(command.kind)) continue;
      if (!FACTORY_KINDS[map.sites[building.id]!.kind].includes(command.kind))
        continue;
      if (ownerOf(map, world, building) !== player.seat) continue;
      if (building.order === command.kind) continue;
      building.order = command.kind;
      building.progress = 0;
    }
  }
}

/**
 * A robot standing on a flag takes its sector for its owner. A flag robots of both teams stand on stays as it is, and
 * a team never takes a flag from itself; when one team's robots stand on another's flag, the lowest-id one takes it.
 * A captured factory starts its default order from scratch.
 */
function capture(map: GameMap, world: World): void {
  const taker = new Map<number, number>();
  const contested = new Set<number>();
  for (const unit of world.units) {
    if (!UNITS[unit.kind].robot) continue;
    const flag = flagAt(map, tileOf(unit.x), tileOf(unit.y));
    if (flag < 0) continue;
    const first = taker.get(flag);
    if (first === undefined) taker.set(flag, unit.owner);
    else if (teamOf(first) !== teamOf(unit.owner)) contested.add(flag);
  }
  for (const [flag, seat] of taker) {
    if (contested.has(flag)) continue;
    const owner = world.sectors[flag]!;
    if (owner !== NEUTRAL && teamOf(owner) === teamOf(seat)) continue;
    world.sectors[flag] = seat;
    for (const building of world.buildings) {
      const site = map.sites[building.id]!;
      if (site.sector !== flag || site.kind === "fort") continue;
      building.order = defaultOrder(site.kind);
      building.progress = 0;
    }
  }
}

/**
 * Every owned factory works on its order at its team's clock, unless its owner is at the unit cap. A finished batch
 * steps out at the factory's door (as many of it as the cap allows) and the next starts.
 */
function produce(map: GameMap, world: World): void {
  const units = new Map<number, number>();
  for (const unit of world.units)
    units.set(unit.owner, (units.get(unit.owner) ?? 0) + 1);
  for (const building of world.buildings) {
    if (building.order === null || building.hp <= 0) continue;
    const owner = ownerOf(map, world, building);
    if (owner === NEUTRAL) continue;
    const count = units.get(owner) ?? 0;
    if (count >= UNIT_CAP) continue;
    const stats = UNITS[building.order];
    building.progress += clockRate(teamSectors(world, teamOf(owner)));
    if (building.progress < stats.build * 100) continue;
    building.progress = 0;
    const door = map.sites[building.id]!.door;
    const batch =
      stats.batch < UNIT_CAP - count ? stats.batch : UNIT_CAP - count;
    for (let index = 0; index < batch; index++)
      world.units.push({
        id: world.nextId++,
        kind: building.order,
        owner,
        x: centreOf(door.x) + (2 * index - (batch - 1)) * div(TILE, 8),
        y: centreOf(door.y),
        hp: stats.hp,
        cooldown: 0,
      });
    units.set(owner, count + batch);
  }
}
