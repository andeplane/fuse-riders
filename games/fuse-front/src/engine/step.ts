/**
 * One engine step: spell and item timers (`spells.ts`, `shop.ts`), the step's commands (casts take effect here), idle heroes' queued
 * orders (`orders.ts`), the heroes' energy and respawns (`hero.ts`), goals (`move.ts`), combat (`combat.ts`), focused
 * heroes' chase (`focus.ts`), movement of units then heroes, STICKY MINEs (`spells.ts`), capture, and production or a lane map's waves
 * (`waves.ts`). `step` never mutates the world it is given: it copies the arrays and records
 * (players, sectors, buildings, units, heroes, mines) and returns a new world, so the netcode can keep the previous
 * one as a snapshot. Once the match has a winner a step only advances the clock. Bots (`bot.ts`) send ordinary
 * commands.
 */
import { MAX_ID, isInt } from "./codec.js";
import { chase, dropFocus, enemyAt } from "./focus.js";
import {
  advanceOrders,
  castable,
  clearQueue,
  enqueue,
  startAttack,
  startMove,
} from "./orders.js";
import { fight } from "./combat.js";
import { OVERCLOCK_PERCENT, cast, tickMines, tickSpells } from "./spells.js";
import { openTile } from "./flow.js";
import { alive, gainXp, moveHeroes, tendHeroes } from "./hero.js";
import { flagAt, type GameMap } from "./map.js";
import { div } from "./math.js";
import { centreOf, chooseGoals, moveUnits, tileOf } from "./move.js";
import { laneMap, spawnWaves } from "./waves.js";
import { guarded, tendCamps } from "./jungle.js";
import { earn } from "./gold.js";
import { ITEMS, ITEM_SLOTS } from "./items.js";
import { buy, sell, tickItems, useItem } from "./shop.js";
import {
  CAPTURE_XP,
  COMMANDS_PER_SEAT,
  GOLD,
  OVERTIME_AFTER,
  OVERTIME_GROWTH,
  OVERTIME_MAX,
  STEER_MAX,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  TILE,
  UNITS,
  clockRate,
  teamOf,
} from "./tuning.js";
import {
  MARKS,
  NEUTRAL,
  NO_WINNER,
  defaultOrder,
  ownerOf,
  teamSectors,
  unitCap,
  type CombatEvent,
  type World,
} from "./world.js";

/**
 * What a player sends (v3 dropped the factory orders and stances; the army is the waves): a walk for the hero to a
 * tile (`move`, in tiles), or the held stick direction (`steer`, each axis -STEER_MAX..STEER_MAX,
 * (0, 0) releasing it). A move releases the stick and a steer cancels the move, so the latest wins. Both apply to a
 * dead hero too: the stick stays held, and a move made while dead is walked after the respawn. `cast` fires the
 * hero's slot 0–3 (Q, W, E, R) aimed at a tile (`spells.ts`); one that cannot be cast does nothing. `attack` focuses
 * the living hero on an enemy (`MARKS` index and id, `focus.ts`), which a later `move`, `attackMove`, held `steer` or
 * `attack` replaces; `attackMove` is a `move` on which the hero stands to fight whatever comes in range. A `move`,
 * `attackMove`, `attack` or `cast` marked `queued` goes behind the hero's current order instead (`orders.ts`).
 * `buy` an `ITEMS` id, `sell` a slot's item and `useItem` a slot's active aimed at a tile go to the shop
 * (`shop.ts`), which refuses one it may not do.
 */
export type Command =
  | { seat: number; type: "move"; x: number; y: number; queued?: boolean }
  | { seat: number; type: "steer"; dx: number; dy: number }
  | { seat: number; type: "attack"; of: number; id: number; queued?: boolean }
  | {
      seat: number;
      type: "attackMove";
      x: number;
      y: number;
      queued?: boolean;
    }
  | {
      seat: number;
      type: "cast";
      slot: number;
      x: number;
      y: number;
      /** A `unit` spell's chosen target (`MARKS` index and id); without it the spell takes what stands nearest the aim. */
      of?: number;
      id?: number;
      queued?: boolean;
    }
  | { seat: number; type: "buy"; item: number }
  | { seat: number; type: "sell"; slot: number }
  | { seat: number; type: "useItem"; slot: number; x: number; y: number };

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
    heroes: world.heroes.map((hero) => ({ ...hero, spells: [...hero.spells] })),
    mines: world.mines.map((mine) => ({ ...mine })),
    fortified: [...world.fortified],
    overclock: [...world.overclock],
    camps: [...world.camps],
    events: [],
  };
  tickSpells(next);
  tickItems(next);
  applyCommands(map, next, commands);
  advanceOrders(map, next);
  tendHeroes(map, next);
  chooseGoals(map, next);
  const { engaged, heroes } = fight(map, next);
  chase(map, next);
  moveUnits(map, next, engaged);
  const holding = new Set(
    next.heroes
      .filter((hero) => hero.sweep > 0 && heroes.has(hero.seat))
      .map((hero) => hero.seat),
  );
  moveHeroes(map, next, holding);
  tickMines(next);
  capture(map, next);
  // A lane map's army is its waves; any other map's is what its factories build.
  if (laneMap(map)) {
    spawnWaves(map, next);
    tendCamps(map, next);
  } else produce(map, next);
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
    if (command.type === "move" || command.type === "attackMove") {
      const hero = world.heroes.find((each) => each.seat === player.seat)!;
      const { x, y } = command;
      if (!isInt(x, 0, map.width - 1) || !isInt(y, 0, map.height - 1)) continue;
      if (!openTile(map, x, y)) continue;
      if (command.queued) enqueue(hero, { type: command.type, x, y });
      else {
        clearQueue(hero);
        startMove(map, hero, x, y, command.type === "attackMove");
      }
    } else if (command.type === "steer") {
      const hero = world.heroes.find((each) => each.seat === player.seat)!;
      const { dx, dy } = command;
      if (!isInt(dx, -STEER_MAX, STEER_MAX)) continue;
      if (!isInt(dy, -STEER_MAX, STEER_MAX)) continue;
      // Releasing the stick leaves a move or focus alone; holding it cancels them.
      if (dx !== 0 || dy !== 0) {
        dropFocus(hero);
        clearQueue(hero);
        [hero.goal, hero.sweep] = [-1, 0];
      }
      [hero.steerX, hero.steerY] = [dx, dy];
    } else if (command.type === "attack") {
      const hero = world.heroes.find((each) => each.seat === player.seat)!;
      const { of, id } = command;
      if (!alive(hero) || !isInt(of, 0, MARKS.length - 1)) continue;
      if (!isInt(id, 0, MAX_ID)) continue;
      if (enemyAt(map, world, teamOf(hero.seat), of, id) === undefined)
        continue;
      if (command.queued) enqueue(hero, { type: "attack", of, id });
      else {
        clearQueue(hero);
        startAttack(hero, of, id);
      }
    } else if (command.type === "buy" || command.type === "sell") {
      const hero = world.heroes.find((each) => each.seat === player.seat)!;
      if (command.type === "buy") {
        if (isInt(command.item, 0, ITEMS.length - 1))
          buy(map, hero, command.item);
      } else if (isInt(command.slot, 0, ITEM_SLOTS - 1))
        sell(map, hero, command.slot);
    } else if (command.type === "useItem") {
      const { slot, x, y } = command;
      if (!isInt(slot, 0, ITEM_SLOTS - 1) || !isInt(x, 0, map.width - 1))
        continue;
      if (!isInt(y, 0, map.height - 1)) continue;
      const hero = world.heroes.find((each) => each.seat === player.seat)!;
      useItem(map, world, hero, slot, x, y);
    } else if (command.type === "cast") {
      const { slot, x, y, of, id } = command;
      if (!isInt(slot, 0, 3) || !isInt(x, 0, map.width - 1)) continue;
      if (!isInt(y, 0, map.height - 1)) continue;
      // A chosen target comes as both its kind and id, or not at all.
      const chosen = of !== undefined || id !== undefined;
      if (chosen && (!isInt(of, 0, MARKS.length - 1) || !isInt(id, 0, MAX_ID)))
        continue;
      const hero = world.heroes.find((h) => h.seat === player.seat)!;
      if (command.queued) {
        // A stored target must be one a checkpoint admits; a plain cast at a bogus one just does nothing.
        const inPlay = (seat: number) =>
          world.players.some((each) => each.seat === seat);
        if (chosen && !castable(map, world.nextId, inPlay, of!, id!)) continue;
        enqueue(hero, {
          type: "cast",
          slot,
          x,
          y,
          of: chosen ? of! : -1,
          id: chosen ? id! : -1,
        });
      } else
        cast(
          map,
          world,
          hero,
          slot,
          x,
          y,
          chosen ? { of: of!, id: id! } : undefined,
        );
    }
  }
}

/**
 * A robot or living hero standing on a flag takes its sector for its owner, whose hero earns `CAPTURE_XP`. A flag
 * both teams stand on stays as it is, and a team never takes a flag from itself; when one team stands on another's
 * flag, the lowest-id robot takes it, or the lowest-seat hero when no robot of that team is there. The taker's hero also
 * earns `GOLD.capture`.
 * A captured factory starts its default order from scratch, and a captured turret starts loaded.
 */
function capture(map: GameMap, world: World): void {
  const taker = new Map<number, number>();
  const contested = new Set<number>();
  /** Flags a CLOAKed hero is the taker of: their capture raises no alert. */
  const quiet = new Set<number>();
  const stand = (seat: number, x: number, y: number, cloaked = false) => {
    const flag = flagAt(map, tileOf(x), tileOf(y));
    if (flag < 0) return;
    const first = taker.get(flag);
    if (first === undefined) taker.set(flag, seat);
    else if (teamOf(first) !== teamOf(seat)) contested.add(flag);
    if (first === undefined && cloaked) quiet.add(flag);
  };
  for (const unit of world.units)
    if (UNITS[unit.kind].robot) stand(unit.owner, unit.x, unit.y);
  for (const hero of world.heroes)
    if (alive(hero)) stand(hero.seat, hero.x, hero.y, hero.cloak > 0);
  for (const [flag, seat] of taker) {
    // A FORTIFIED flag cannot change hands (`spells.ts`), nor on a lane map a home flag or a guarded jungle one.
    if (contested.has(flag) || world.fortified[flag]! > 0) continue;
    if (laneMap(map) && map.sectorKinds[flag] !== "jungle") continue;
    if (guarded(map, world, flag)) continue;
    const owner = world.sectors[flag]!;
    if (owner !== NEUTRAL && teamOf(owner) === teamOf(seat)) continue;
    world.sectors[flag] = seat;
    if (!quiet.has(flag))
      world.events.push({ type: "capture", sector: flag, seat });
    const hero = world.heroes.find((each) => each.seat === seat)!;
    gainXp(world, hero, CAPTURE_XP);
    earn(hero, GOLD.capture);
    for (const building of world.buildings) {
      const site = map.sites[building.id]!;
      // A fort and a lane's towers (`towers.ts`) never belong to a sector's holder.
      if (site.sector !== flag || site.kind === "fort" || site.lane >= 0)
        continue;
      building.order = defaultOrder(site.kind);
      building.progress = 0;
      building.cooldown = 0;
    }
  }
}

/**
 * A team's production clock this step (`clockRate`), raised in overtime when it holds more sectors than the other
 * team: `OVERTIME_GROWTH` percent per minute past `OVERTIME_AFTER`, up to `OVERTIME_MAX`.
 */
export function productionRate(world: World, team: number): number {
  const ours = teamSectors(world, team);
  // OVERCLOCK (`spells.ts`) speeds the team's clock while it runs.
  const boost = world.overclock[team]! > 0 ? OVERCLOCK_PERCENT : 100;
  const rate = div(clockRate(ours) * boost, 100);
  const late = world.step - OVERTIME_AFTER;
  if (late <= 0 || ours <= teamSectors(world, 1 - team)) return rate;
  const grown = div(late * OVERTIME_GROWTH, 60 * STEPS_PER_SECOND);
  return div(rate * (100 + (grown < OVERTIME_MAX ? grown : OVERTIME_MAX)), 100);
}

/**
 * Every owned factory works on its order at its team's rate, unless its owner is at its unit cap (`unitCap`). A
 * finished batch steps out at the factory's door (as many of it as the cap allows) and the next starts.
 */
function produce(map: GameMap, world: World): void {
  const units = new Map<number, number>();
  for (const unit of world.units)
    units.set(unit.owner, (units.get(unit.owner) ?? 0) + 1);
  const caps = new Map(
    world.players.map((player) => [player.seat, unitCap(world, player.seat)]),
  );
  const rates = [productionRate(world, 0), productionRate(world, 1)];
  for (const building of world.buildings) {
    if (building.order === null || building.hp <= 0) continue;
    const owner = ownerOf(map, world, building);
    if (owner === NEUTRAL) continue;
    const count = units.get(owner) ?? 0;
    const cap = caps.get(owner)!;
    if (count >= cap) continue;
    const stats = UNITS[building.order];
    building.progress += rates[teamOf(owner)]!;
    if (building.progress < stats.build * 100) continue;
    building.progress = 0;
    const door = map.sites[building.id]!.door;
    const batch = stats.batch < cap - count ? stats.batch : cap - count;
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
        stun: 0,
        rally: 0,
        lane: -1,
        wave: 0,
      });
    units.set(owner, count + batch);
  }
}
