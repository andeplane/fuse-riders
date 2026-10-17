/**
 * One engine step: the step's commands, the heroes' energy and respawns (`hero.ts`), goals (`move.ts`), combat
 * (`combat.ts`), movement of units then heroes, capture and production. `step` never mutates the world it is given: it
 * copies the arrays and records (players, sectors, buildings, units, heroes) and returns a new world, so the netcode
 * can keep the previous one as a snapshot. Once the match has a winner a step only advances the clock. Bots and
 * spells arrive in later rules.
 */
import { isInt } from "./codec.js";
import { fight } from "./combat.js";
import { openTile } from "./flow.js";
import { alive, gainXp, moveHeroes, tendHeroes } from "./hero.js";
import { flagAt, type GameMap } from "./map.js";
import { div } from "./math.js";
import { centreOf, chooseGoals, moveUnits, tileOf } from "./move.js";
import {
  CAPTURE_XP,
  COMMANDS_PER_SEAT,
  FACTORY_KINDS,
  STANCES,
  STEER_MAX,
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
  NO_WINNER,
  defaultOrder,
  ownerOf,
  teamSectors,
  type CombatEvent,
  type World,
} from "./world.js";

/**
 * What a player sends: a factory's standing order, the stance of every unit that player's factories built, a walk
 * for the hero to a tile (`move`, in tiles), or the held stick direction (`steer`, each axis -STEER_MAX..STEER_MAX,
 * (0, 0) releasing it). A move releases the stick and a steer cancels the move, so the latest wins. Both apply to a
 * dead hero too: the stick stays held, and a move made while dead is walked after the respawn.
 */
export type Command =
  | { seat: number; type: "order"; factory: number; kind: UnitKind }
  | { seat: number; type: "stance"; stance: Stance }
  | { seat: number; type: "move"; x: number; y: number }
  | { seat: number; type: "steer"; dx: number; dy: number };

export function step(
  map: GameMap,
  world: World,
  commands: readonly Command[] = [],
): World {
  if (world.winner !== NO_WINNER)
    return { ...world, step: world.step + 1, events: [] };
  const next: World = {
    ...world,
    step: world.step + 1,
    players: world.players.map((player) => ({ ...player })),
    sectors: [...world.sectors],
    buildings: world.buildings.map((building) => ({ ...building })),
    units: world.units.map((unit) => ({ ...unit })),
    heroes: world.heroes.map((hero) => ({ ...hero })),
    events: [],
  };
  applyCommands(map, next, commands);
  tendHeroes(map, next);
  chooseGoals(map, next);
  const engaged = fight(map, next);
  moveUnits(map, next, engaged);
  moveHeroes(map, next);
  capture(map, next);
  produce(map, next);
  return next;
}

/** One 50 ms log tick: the tick's commands apply at its first step, and its events are its steps' in order. */
export function stepTick(
  map: GameMap,
  world: World,
  commands: readonly Command[] = [],
): World {
  let next = world;
  const events: CombatEvent[] = [];
  for (let index = 0; index < STEPS_PER_TICK; index++) {
    next = step(map, next, index === 0 ? commands : []);
    events.push(...next.events);
  }
  return { ...next, events };
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
      if (!(STANCES as readonly unknown[]).includes(command.stance)) continue;
      if (player.stance === command.stance) continue;
      player.stance = command.stance;
      // The player's units pick goals under the new stance this step.
      for (const unit of world.units)
        if (unit.owner === player.seat) unit.goal = -1;
    } else if (command.type === "move" || command.type === "steer") {
      const hero = world.heroes.find((each) => each.seat === player.seat)!;
      if (command.type === "move") {
        const { x, y } = command;
        if (!isInt(x, 0, map.width - 1) || !isInt(y, 0, map.height - 1))
          continue;
        if (!openTile(map, x, y)) continue;
        [hero.goal, hero.steerX, hero.steerY] = [y * map.width + x, 0, 0];
      } else {
        const { dx, dy } = command;
        if (!isInt(dx, -STEER_MAX, STEER_MAX)) continue;
        if (!isInt(dy, -STEER_MAX, STEER_MAX)) continue;
        // Releasing the stick leaves a move alone; holding it cancels one.
        if (dx !== 0 || dy !== 0) hero.goal = -1;
        [hero.steerX, hero.steerY] = [dx, dy];
      }
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
 * A robot or living hero standing on a flag takes its sector for its owner, whose hero earns `CAPTURE_XP`. A flag
 * both teams stand on stays as it is, and a team never takes a flag from itself; when one team stands on another's
 * flag, the lowest-id robot takes it, or the lowest-seat hero when no robot of that team is there.
 * A captured factory starts its default order from scratch, and a captured turret starts loaded.
 */
function capture(map: GameMap, world: World): void {
  const taker = new Map<number, number>();
  const contested = new Set<number>();
  const stand = (seat: number, x: number, y: number): void => {
    const flag = flagAt(map, tileOf(x), tileOf(y));
    if (flag < 0) return;
    const first = taker.get(flag);
    if (first === undefined) taker.set(flag, seat);
    else if (teamOf(first) !== teamOf(seat)) contested.add(flag);
  };
  for (const unit of world.units)
    if (UNITS[unit.kind].robot) stand(unit.owner, unit.x, unit.y);
  for (const hero of world.heroes)
    if (alive(hero)) stand(hero.seat, hero.x, hero.y);
  for (const [flag, seat] of taker) {
    if (contested.has(flag)) continue;
    const owner = world.sectors[flag]!;
    if (owner !== NEUTRAL && teamOf(owner) === teamOf(seat)) continue;
    world.sectors[flag] = seat;
    gainXp(
      world,
      world.heroes.find((hero) => hero.seat === seat)!,
      CAPTURE_XP,
    );
    for (const building of world.buildings) {
      const site = map.sites[building.id]!;
      if (site.sector !== flag || site.kind === "fort") continue;
      building.order = defaultOrder(site.kind);
      building.progress = 0;
      building.cooldown = 0;
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
        goal: -1,
      });
    units.set(owner, count + batch);
  }
}
