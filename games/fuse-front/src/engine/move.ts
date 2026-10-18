/**
 * Movement and stances. Each unit carries a goal tile, picked from its owner's stance on a cadence (`chooseGoals`),
 * and every step walks the goal's flow field (`flow.ts`) while pushing apart from units too close to it (`moveUnits`).
 * Both work from where units stood when the phase began, in unit-id order, and no move ever lands on a tile nothing
 * walks on or cuts a blocked corner.
 *
 * - PUSH: the nearest flag (by walking cost) the unit's team does not own; a robot walks onto it and takes it. With no
 *   such flag reachable, the nearest standing enemy fort, walked up to until something is in range (flags first, so
 *   a team takes the map before it sieges; a fort's own sector is taken like any other on the way).
 * - HOLD: the team's own flags, nearest first, counting `HOLD_CROWD` per teammate already bound there; it stops within
 *   `HOLD_RADIUS` of it. With no flag left it holds the owner's fort, as does PUSH with nothing left at all.
 * - A unit with an enemy in range (`combat.ts`), or stunned (`spells.ts`), stands instead of seeking; separation still
 *   applies.
 * - FOLLOW: stays within `HOLD_RADIUS` of the owner's hero, or holds the owner's fort while it is dead (`FOLLOW_HERO`).
 * - While the owner's FLARE burns (`spells.ts`), a PUSHing robot makes for its tile instead (`FLARE`), taking the flag
 *   there if it is one; when it goes out the robot picks again.
 */
import { DIRS, UNREACHABLE, flowField, openTile } from "./flow.js";
import type { GameMap } from "./map.js";
import { clamp, div, isqrt } from "./math.js";
import {
  BLITZ_SPEED,
  HOLD_CROWD,
  HOLD_RADIUS,
  RALLY_SPEED,
  RETHINK_STEPS,
  TILE,
  UNITS,
  teamOf,
  type Stance,
} from "./tuning.js";
import { NEUTRAL, type Unit, type World } from "./world.js";

/** The tile a sub-pixel coordinate lies on. */
export const tileOf = (sub: number): number => div(sub, TILE);
/** A tile's centre in sub-pixels. */
export const centreOf = (tile: number): number => tile * TILE + div(TILE, 2);

const tileIndex = (map: GameMap, unit: Unit): number =>
  tileOf(unit.y) * map.width + tileOf(unit.x);

const ours = (owner: number, team: number): boolean =>
  owner !== NEUTRAL && teamOf(owner) === team;

/** The flag index whose tile `tile` is, or -1. A flag's own tile always lies in its sector. */
function flagOnTile(map: GameMap, tile: number): number {
  const sector = map.sectorOf[tile] ?? -1;
  if (sector < 0) return -1;
  const flag = map.flags[sector]!;
  return flag.y * map.width + flag.x === tile ? sector : -1;
}

/** The tile of a seat's fort, or -1. */
function fortTile(map: GameMap, seat: number): number {
  const site = map.sites.find(
    (each) => each.kind === "fort" && each.seat === seat,
  );
  return site === undefined ? -1 : site.y * map.width + site.x;
}

/** The tiles of the standing forts of seats not on `team`. */
function enemyForts(map: GameMap, world: World, team: number): number[] {
  const tiles: number[] = [];
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (site.kind === "fort" && building.hp > 0 && teamOf(site.seat) !== team)
      tiles.push(site.y * map.width + site.x);
  }
  return tiles;
}

/**
 * FOLLOW's goal, kept in `Unit.goal` instead of a tile: the tile the owner's hero stands on, looked up every step, or
 * the owner's fort while the hero is dead. So a unit's goal is a flag, a fort or this, and the fixed flow cache holds
 * only flags and forts; one tile per hero (plus each hero's `move` goal) goes to the roaming cache (`flow.ts`).
 */
export const FOLLOW_HERO = -2;
/** A PUSHing robot's goal while its owner's FLARE burns (`spells.ts`): the flare's tile, from the roaming cache. */
export const FLARE = -3;

/** The tile a unit's goal points at now: its own tile index, its hero's (or fort's) tile, or its hero's flare. */
function goalTile(map: GameMap, world: World, unit: Unit): number {
  if (unit.goal >= -1) return unit.goal;
  const hero = world.heroes.find((each) => each.seat === unit.owner);
  if (unit.goal === FLARE) return hero?.flare ?? -1;
  return hero !== undefined && hero.hp > 0
    ? tileOf(hero.y) * map.width + tileOf(hero.x)
    : fortTile(map, unit.owner);
}

/** Whether a stance can send a unit to `tile`: a flag's tile or a fort's (FOLLOW uses `FOLLOW_HERO`). */
export const isGoalTile = (map: GameMap, tile: number): boolean =>
  flagOnTile(map, tile) >= 0 ||
  map.sites.some(
    (site) => site.kind === "fort" && site.y * map.width + site.x === tile,
  );

/** The cheapest of `goals` to walk to from `from`, plus `extra`; ties to the first listed, -1 when none is reachable. */
function nearest(
  map: GameMap,
  from: number,
  goals: readonly number[],
  extra: (goal: number) => number = () => 0,
): number {
  let best = -1,
    bestCost = UNREACHABLE;
  for (const goal of goals) {
    if (goal < 0) continue;
    const cost = flowField(map, goal).cost[from]!;
    if (cost === UNREACHABLE) continue;
    if (cost + extra(goal) < bestCost)
      [best, bestCost] = [goal, cost + extra(goal)];
  }
  return best;
}

function pickGoal(
  map: GameMap,
  world: World,
  unit: Unit,
  stance: Stance,
  bound: Map<number, number>,
): number {
  const from = tileIndex(map, unit);
  const team = teamOf(unit.owner);
  const flags = map.flags.map((flag) => flag.y * map.width + flag.x);
  if (stance === "follow") return FOLLOW_HERO;
  if (stance === "push") {
    // A flare the robot can walk to; one cut off from it leaves its usual goal.
    const flare = world.heroes.find((each) => each.seat === unit.owner)?.flare;
    if (flare !== undefined && flare >= 0 && UNITS[unit.kind].robot)
      if (flowField(map, flare, true).cost[from] !== UNREACHABLE) return FLARE;
    const goal = nearest(
      map,
      from,
      flags.filter((_, index) => !ours(world.sectors[index]!, team)),
    );
    if (goal >= 0) return goal;
    const fort = nearest(map, from, enemyForts(map, world, team));
    if (fort >= 0) return fort;
  }
  const tiles = map.width * map.height;
  const goal = nearest(
    map,
    from,
    flags.filter((_, index) => ours(world.sectors[index]!, team)),
    (tile) => HOLD_CROWD * (bound.get(team * tiles + tile) ?? 0),
  );
  return goal >= 0 ? goal : nearest(map, from, [fortTile(map, unit.owner)]);
}

/**
 * Picks goals for the units due one: those with none, those whose turn of the `RETHINK_STEPS` cadence it is
 * (staggered by id so the work spreads over steps), and pushing units standing on a flag their team now holds.
 */
export function chooseGoals(map: GameMap, world: World): void {
  const stances = new Map(world.players.map((p) => [p.seat, p.stance]));
  const tiles = map.width * map.height;
  // How many of each team's units are bound for each tile, for HOLD's spread.
  const bound = new Map<number, number>();
  const bind = (unit: Unit, by: number): void => {
    if (unit.goal < 0) return;
    const key = teamOf(unit.owner) * tiles + unit.goal;
    bound.set(key, (bound.get(key) ?? 0) + by);
  };
  for (const unit of world.units) bind(unit, 1);
  for (const unit of world.units) {
    const stance = stances.get(unit.owner)!;
    const flag = unit.goal < 0 ? -1 : flagOnTile(map, unit.goal);
    const due =
      unit.goal === -1 ||
      (world.step + unit.id) % RETHINK_STEPS === 0 ||
      (stance === "push" &&
        flag >= 0 &&
        tileIndex(map, unit) === unit.goal &&
        ours(world.sectors[flag]!, teamOf(unit.owner)));
    if (!due) continue;
    bind(unit, -1);
    unit.goal = pickGoal(map, world, unit, stance, bound);
    bind(unit, 1);
  }
}

/** The velocity toward the unit's goal: a capturing robot walks onto its flag's centre, others stop near the goal. */
function seek(map: GameMap, world: World, unit: Unit): [number, number] {
  const goal = goalTile(map, world, unit);
  if (goal < 0) return [0, 0];
  const at = tileIndex(map, unit);
  const field = flowField(map, goal, unit.goal < -1);
  const cost = field.cost[at]!;
  if (cost === UNREACHABLE) return [0, 0];
  const flag = flagOnTile(map, goal);
  const capturing =
    UNITS[unit.kind].robot &&
    flag >= 0 &&
    !ours(world.sectors[flag]!, teamOf(unit.owner));
  // A sieging unit closes until it is in range of something and stands to fight (`moveUnits`).
  const sieging =
    !capturing && enemyForts(map, world, teamOf(unit.owner)).includes(goal);
  if (!capturing && !sieging && cost <= HOLD_RADIUS) return [0, 0];
  let target = goal;
  if (cost > 0) {
    const [dx, dy] = DIRS[field.next[at]!]!;
    target = at + dy * map.width + dx;
  }
  const tx = target % map.width;
  const dx = centreOf(tx) - unit.x,
    dy = centreOf((target - tx) / map.width) - unit.y;
  // RALLY CRY and its owner's BLITZ (in the sector its hero stands in) each add their share.
  const hero = world.heroes.find((each) => each.seat === unit.owner);
  const sector = (x: number, y: number) =>
    map.sectorOf[tileOf(y) * map.width + tileOf(x)];
  const blitz =
    hero !== undefined &&
    hero.blitz > 0 &&
    hero.hp > 0 &&
    UNITS[unit.kind].robot &&
    sector(hero.x, hero.y) === sector(unit.x, unit.y);
  const boost = (unit.rally > 0 ? RALLY_SPEED : 0) + (blitz ? BLITZ_SPEED : 0);
  const speed = div(UNITS[unit.kind].speed * (100 + boost), 100);
  const length = isqrt(dx * dx + dy * dy);
  if (length <= speed) return [dx, dy];
  return [div(dx * speed, length), div(dy * speed, length)];
}

/** An empty cell, shared so the 3 × 3 scan allocates nothing for tiles nobody stands on. */
const NO_UNITS: readonly number[] = [];

/**
 * The push away from units overlapping this one (closer than their radii summed), half the overlap each, capped at
 * the unit's speed. Two units on the very same sub-pixel part along a direction both derive from their ids.
 */
function separate(
  map: GameMap,
  units: readonly Unit[],
  cells: ReadonlyMap<number, readonly number[]>,
  index: number,
): [number, number] {
  const unit = units[index]!;
  const tx = tileOf(unit.x),
    ty = tileOf(unit.y);
  let sx = 0,
    sy = 0;
  // The largest reach is one tile, so the 3 × 3 tiles around hold every unit that can overlap.
  for (let y = ty - 1; y <= ty + 1; y++)
    for (let x = tx - 1; x <= tx + 1; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      for (const other of cells.get(y * map.width + x) ?? NO_UNITS) {
        if (other === index) continue;
        const them = units[other]!;
        const reach = UNITS[unit.kind].radius + UNITS[them.kind].radius;
        let dx = unit.x - them.x,
          dy = unit.y - them.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        let length = 1;
        if (d2 === 0) {
          const [ex, ey] = DIRS[(unit.id + them.id) % DIRS.length]!;
          const sign = unit.id < them.id ? -1 : 1;
          [dx, dy] = [sign * ex, sign * ey];
        } else length = isqrt(d2);
        const push = div(reach - length, 2);
        sx += div(dx * push, length);
        sy += div(dy * push, length);
      }
    }
  const speed = UNITS[unit.kind].speed;
  return [clamp(sx, -speed, speed), clamp(sy, -speed, speed)];
}

/** Whether a sub-pixel point lies on open ground. */
const openAt = (map: GameMap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && openTile(map, tileOf(x), tileOf(y));

/** The furthest of the whole move, its x part and its y part that stays on open ground without cutting a corner. */
export function settle(
  map: GameMap,
  x: number,
  y: number,
  nx: number,
  ny: number,
): [number, number] {
  const fits = (px: number, py: number): boolean =>
    openAt(map, px, py) &&
    (tileOf(px) === tileOf(x) ||
      tileOf(py) === tileOf(y) ||
      (openAt(map, px, y) && openAt(map, x, py)));
  if (fits(nx, ny)) return [nx, ny];
  if (fits(nx, y)) return [nx, y];
  if (fits(x, ny)) return [x, ny];
  return [x, y];
}

/**
 * Moves every unit one step: seek plus separation, computed from where every unit stood when the step began. Units
 * in `engaged` (by id) stand to fight and only separate.
 */
export function moveUnits(
  map: GameMap,
  world: World,
  engaged: ReadonlySet<number> = new Set(),
): void {
  const units = world.units;
  // The spatial hash, rebuilt each step: unit indices by tile, in id order.
  const cells = new Map<number, number[]>();
  for (const [index, unit] of units.entries()) {
    const key = tileIndex(map, unit);
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [index]);
    else cell.push(index);
  }
  const moved = units.map((unit, index) => {
    const still = engaged.has(unit.id) || unit.stun > 0;
    const [vx, vy] = still ? [0, 0] : seek(map, world, unit);
    const [sx, sy] = separate(map, units, cells, index);
    return settle(map, unit.x, unit.y, unit.x + vx + sx, unit.y + vy + sy);
  });
  for (const [index, unit] of units.entries()) [unit.x, unit.y] = moved[index]!;
}
