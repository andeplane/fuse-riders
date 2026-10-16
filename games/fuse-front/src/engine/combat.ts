/**
 * Combat, between goals and movement in a step. Every unit and every turret a seat holds takes the nearest enemy in
 * range: an enemy unit, a turret held by the other team, or an enemy fort (factories are captured, never shot). Ties
 * go to units before buildings, then the lower id. Targets are picked from where everything stood when the phase
 * began and shots are instant hits applied together, so the order units fire in cannot change who hits what.
 *
 * - A shooter fires when its cooldown is 0 and then waits its kind's `cooldown` steps; the timer counts down every step.
 * - A unit with a target in range stands still to fight (`moveUnits` skips its seek), even while reloading.
 * - Units at 0 hit points are removed, in id order. A turret or fort at 0 stays as a ruin: it neither fires nor is
 *   targeted, and a team whose last fort falls loses (`winnerOf`).
 */
import type { GameMap } from "./map.js";
import { ceilDiv, div } from "./math.js";
import { centreOf } from "./move.js";
import { TILE, TURRET, UNITS, teamOf } from "./tuning.js";
import {
  NEUTRAL,
  NO_WINNER,
  ownerOf,
  winnerOf,
  type Mark,
  type World,
} from "./world.js";

/** The spatial hash's cell: 4 tiles, so the longest range (6 tiles) scans 5 × 5 cells. */
const CELL = 4 * TILE;

interface Target extends Mark {
  team: number;
  /** Index into `world.units` or `world.buildings`. */
  index: number;
}

/** Whether `a` is a better target than `b` at squared distances `da` and `db`. */
const better = (a: Target, da: number, b: Target, db: number): boolean =>
  da !== db ? da < db : a.building !== b.building ? !a.building : a.id < b.id;

const mark = ({ building, id, x, y }: Mark): Mark => ({ building, id, x, y });

/** Fires every ready shooter and applies the result; returns the ids of units that stand to fight this step. */
export function fight(map: GameMap, world: World): Set<number> {
  const engaged = new Set<number>();
  const targets: Target[] = [];
  for (const [index, unit] of world.units.entries())
    targets.push({
      building: false,
      id: unit.id,
      x: unit.x,
      y: unit.y,
      team: teamOf(unit.owner),
      index,
    });
  for (const [index, building] of world.buildings.entries()) {
    const site = map.sites[building.id]!;
    const owner = ownerOf(map, world, building);
    if (building.hp <= 0 || owner === NEUTRAL) continue;
    if (site.kind !== "turret" && site.kind !== "fort") continue;
    targets.push({
      building: true,
      id: building.id,
      x: centreOf(site.x),
      y: centreOf(site.y),
      team: teamOf(owner),
      index,
    });
  }
  const columns = ceilDiv(map.width * TILE, CELL);
  const cells = new Map<number, Target[]>();
  for (const target of targets) {
    const key = div(target.y, CELL) * columns + div(target.x, CELL);
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [target]);
    else cell.push(target);
  }
  const rows = ceilDiv(map.height * TILE, CELL);
  const nearest = (from: Target, range: number): Target | undefined => {
    const reach = ceilDiv(range, CELL);
    const cx = div(from.x, CELL),
      cy = div(from.y, CELL);
    let best: Target | undefined,
      bestD = 0;
    for (let y = cy - reach; y <= cy + reach; y++)
      for (let x = cx - reach; x <= cx + reach; x++) {
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
        for (const target of cells.get(y * columns + x) ?? []) {
          if (target.team === from.team) continue;
          const dx = target.x - from.x,
            dy = target.y - from.y;
          const d = dx * dx + dy * dy;
          if (d > range * range) continue;
          if (best === undefined || better(target, d, best, bestD))
            [best, bestD] = [target, d];
        }
      }
    return best;
  };

  const unitDamage = world.units.map(() => 0);
  const buildingDamage = world.buildings.map(() => 0);
  for (const from of targets) {
    const unit = from.building ? undefined : world.units[from.index]!;
    const building = from.building ? world.buildings[from.index]! : undefined;
    if (building !== undefined && map.sites[building.id]!.kind !== "turret")
      continue;
    const stats = unit === undefined ? TURRET : UNITS[unit.kind];
    const shooter = unit ?? building!;
    if (shooter.cooldown > 0) shooter.cooldown--;
    const target = nearest(from, stats.range);
    if (target === undefined) continue;
    if (unit !== undefined) engaged.add(unit.id);
    if (shooter.cooldown > 0) continue;
    shooter.cooldown = stats.cooldown;
    let damage = stats.damage;
    if (target.building) {
      if (unit !== undefined)
        damage = div(damage * UNITS[unit.kind].siege, 100);
      buildingDamage[target.index]! += damage;
    } else unitDamage[target.index]! += damage;
    world.events.push({
      type: "shot",
      from: mark(from),
      to: mark(target),
      damage,
    });
  }

  for (const [index, building] of world.buildings.entries()) {
    const damage = buildingDamage[index]!;
    if (damage === 0) continue;
    building.hp = damage >= building.hp ? 0 : building.hp - damage;
    if (building.hp === 0) {
      building.cooldown = 0;
      const kind = map.sites[building.id]!.kind;
      world.events.push({ type: "destroyed", building: building.id, kind });
    }
  }
  world.units = world.units.filter((unit, index) => {
    unit.hp -= unitDamage[index]!;
    if (unit.hp > 0) return true;
    const { id, kind, owner, x, y } = unit;
    world.events.push({ type: "death", id, kind, owner, x, y });
    engaged.delete(id);
    return false;
  });
  world.winner = winnerOf(map, world.players, world.buildings);
  if (world.winner !== NO_WINNER)
    world.events.push({ type: "won", winner: world.winner });
  return engaged;
}
