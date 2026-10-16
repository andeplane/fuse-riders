/**
 * Movement and stances. Each unit carries a goal tile, picked from its owner's stance on a cadence (`chooseGoals`),
 * and every step walks the goal's flow field (`flow.ts`) while pushing apart from units too close to it (`moveUnits`).
 * Both work from where units stood when the phase began, in unit-id order, and no move ever lands on a tile nothing
 * walks on or cuts a blocked corner.
 *
 * - PUSH: the nearest flag (by walking cost) the unit's team does not own; a robot walks onto it and takes it.
 * - HOLD: the team's own flags, nearest first, counting `HOLD_CROWD` per teammate already bound there; it stops within
 *   `HOLD_RADIUS` of it. With no flag left it holds the owner's fort, as does PUSH with nothing left to take.
 * - FOLLOW: holds the owner's fort until heroes arrive (see `followGoal`).
 */
import { DIRS, UNREACHABLE, flowField, openTile } from "./flow.js";
import type { GameMap } from "./map.js";
import { clamp, div, isqrt } from "./math.js";
import {
  HOLD_CROWD,
  HOLD_RADIUS,
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

/**
 * FOLLOW's goal. TODO(hero): Engine III gives each player a hero; FOLLOW then targets the tile the owner's hero stands
 * on (re-picked on the same cadence). Until then it holds the owner's fort.
 */
function followGoal(map: GameMap, from: number, unit: Unit): number {
  return nearest(map, from, [fortTile(map, unit.owner)]);
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
  if (stance === "follow") return followGoal(map, from, unit);
  if (stance === "push") {
    const goal = nearest(
      map,
      from,
      flags.filter((_, index) => !ours(world.sectors[index]!, team)),
    );
    if (goal >= 0) return goal;
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
      unit.goal < 0 ||
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
  if (unit.goal < 0) return [0, 0];
  const at = tileIndex(map, unit);
  const field = flowField(map, unit.goal);
  const cost = field.cost[at]!;
  if (cost === UNREACHABLE) return [0, 0];
  const flag = flagOnTile(map, unit.goal);
  const capturing =
    UNITS[unit.kind].robot &&
    flag >= 0 &&
    !ours(world.sectors[flag]!, teamOf(unit.owner));
  if (!capturing && cost <= HOLD_RADIUS) return [0, 0];
  let target = unit.goal;
  if (cost > 0) {
    const [dx, dy] = DIRS[field.next[at]!]!;
    target = at + dy * map.width + dx;
  }
  const tx = target % map.width;
  const dx = centreOf(tx) - unit.x,
    dy = centreOf((target - tx) / map.width) - unit.y;
  const speed = UNITS[unit.kind].speed;
  const length = isqrt(dx * dx + dy * dy);
  if (length <= speed) return [dx, dy];
  return [div(dx * speed, length), div(dy * speed, length)];
}

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
      for (const other of cells.get(y * map.width + x) ?? []) {
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
function settle(
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

/** Moves every unit one step: seek plus separation, computed from where every unit stood when the step began. */
export function moveUnits(map: GameMap, world: World): void {
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
    const [vx, vy] = seek(map, world, unit);
    const [sx, sy] = separate(map, units, cells, index);
    return settle(map, unit.x, unit.y, unit.x + vx + sx, unit.y + vy + sy);
  });
  for (const [index, unit] of units.entries()) [unit.x, unit.y] = moved[index]!;
}
