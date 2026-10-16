/**
 * Combat, between goals and movement in a step. Every unit, living hero and turret a seat holds takes the nearest
 * enemy in range: an enemy unit or hero, a turret held by the other team, or an enemy fort (factories are captured,
 * never shot). Ties go to units, then heroes, then buildings, then the lower id. Targets are picked from where
 * everything stood when the phase began and shots are instant hits applied together, so the order units fire in
 * cannot change who hits what.
 *
 * - A shooter fires when its cooldown is 0 and then waits its kind's `cooldown` steps; the timer counts down every step.
 * - A unit with a target in range stands still to fight (`moveUnits` skips its seek), even while reloading. A hero
 *   shoots whether it stands or walks.
 * - A robot within `AURA_RADIUS` of its owner's living hero does `AURA_DAMAGE` percent damage.
 * - A kill is credited to the owner of the first shot (in shooter order: units by id, heroes by seat, turrets) that hit
 *   the victim this step, and earns XP (`award`).
 * - Units at 0 hit points are removed, in id order; heroes at 0 wait to respawn (`hero.ts`). A turret or fort at 0
 *   stays as a ruin: it neither fires nor is targeted, and a team whose last fort falls loses (`winnerOf`).
 */
import {
  alive,
  award,
  facingOf,
  heroShot,
  levelOf,
  respawnSteps,
} from "./hero.js";
import type { GameMap } from "./map.js";
import { ceilDiv, div } from "./math.js";
import { centreOf } from "./move.js";
import {
  AURA_DAMAGE,
  AURA_RADIUS,
  HERO_XP,
  HERO_XP_PER_LEVEL,
  KILL_XP,
  TILE,
  TURRET,
  UNITS,
  teamOf,
} from "./tuning.js";
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
  /** The seat a shot from it is credited to. */
  owner: number;
  /** Index into `world.units`, `world.heroes` or `world.buildings`. */
  index: number;
  /** Damage taken this step, and the seat of the first shot that hit it (-1 for none). */
  taken: number;
  killer: number;
}

const target = (
  of: Mark["of"],
  id: number,
  x: number,
  y: number,
  owner: number,
  index: number,
): Target => ({
  of,
  id,
  x,
  y,
  team: teamOf(owner),
  owner,
  index,
  taken: 0,
  killer: -1,
});

/** An empty cell, shared so the 5 × 5 scan allocates nothing for cells nobody stands in. */
const NO_TARGETS: readonly Target[] = [];

const RANK = { unit: 0, hero: 1, building: 2 } as const;

/** Whether `a` is a better target than `b` at squared distances `da` and `db`. */
const better = (a: Target, da: number, b: Target, db: number): boolean =>
  da !== db ? da < db : a.of !== b.of ? RANK[a.of] < RANK[b.of] : a.id < b.id;

const mark = ({ of, id, x, y }: Mark): Mark => ({ of, id, x, y });

/** Fires every ready shooter and applies the result; returns the ids of units that stand to fight this step. */
export function fight(map: GameMap, world: World): Set<number> {
  const engaged = new Set<number>();
  // Units first, in order, so `targets[index]` is `world.units[index]`'s.
  const targets: Target[] = world.units.map((unit, index) =>
    target("unit", unit.id, unit.x, unit.y, unit.owner, index),
  );
  for (const [index, hero] of world.heroes.entries())
    if (alive(hero))
      targets.push(target("hero", hero.seat, hero.x, hero.y, hero.seat, index));
  for (const [index, building] of world.buildings.entries()) {
    const site = map.sites[building.id]!;
    const owner = ownerOf(map, world, building);
    if (building.hp <= 0 || owner === NEUTRAL) continue;
    if (site.kind !== "turret" && site.kind !== "fort") continue;
    const [x, y] = [centreOf(site.x), centreOf(site.y)];
    targets.push(target("building", building.id, x, y, owner, index));
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
        for (const target of cells.get(y * columns + x) ?? NO_TARGETS) {
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
  /** Whether a unit stands in its owner's hero's aura. */
  const inAura = (from: Target): boolean => {
    const hero = world.heroes.find((each) => each.seat === from.owner);
    if (hero === undefined || !alive(hero)) return false;
    const dx = hero.x - from.x,
      dy = hero.y - from.y;
    return dx * dx + dy * dy <= AURA_RADIUS * AURA_RADIUS;
  };

  for (const from of targets) {
    const unit = from.of === "unit" ? world.units[from.index]! : undefined;
    const hero = from.of === "hero" ? world.heroes[from.index]! : undefined;
    const building =
      from.of === "building" ? world.buildings[from.index]! : undefined;
    if (building !== undefined && map.sites[building.id]!.kind !== "turret")
      continue;
    const shooter = unit ?? hero ?? building!;
    const stats = unit
      ? UNITS[unit.kind]
      : hero
        ? heroShot(levelOf(hero.xp))
        : { ...TURRET, siege: 100 };
    if (shooter.cooldown > 0) shooter.cooldown--;
    const victim = nearest(from, stats.range);
    if (victim === undefined) continue;
    if (unit !== undefined) engaged.add(unit.id);
    if (shooter.cooldown > 0) continue;
    shooter.cooldown = stats.cooldown;
    let damage = stats.damage;
    if (unit !== undefined && UNITS[unit.kind].robot && inAura(from))
      damage = div(damage * AURA_DAMAGE, 100);
    if (victim.of === "building") damage = div(damage * stats.siege, 100);
    if (hero !== undefined)
      hero.facing = facingOf(victim.x - hero.x, victim.y - hero.y, hero.facing);
    victim.taken += damage;
    if (victim.killer < 0) victim.killer = from.owner;
    world.events.push({
      type: "shot",
      from: mark(from),
      to: mark(victim),
      damage,
    });
  }

  // Deaths first, then XP, so a hero that falls this step earns no assist from it.
  const kills: number[][] = [];
  for (const { of, index, taken, killer } of targets) {
    if (taken === 0 || of === "unit") continue;
    if (of === "building") {
      const building = world.buildings[index]!;
      building.hp = taken >= building.hp ? 0 : building.hp - taken;
      if (building.hp > 0) continue;
      building.cooldown = 0;
      const kind = map.sites[building.id]!.kind;
      world.events.push({ type: "destroyed", building: building.id, kind });
      continue;
    }
    const hero = world.heroes[index]!;
    if (taken < hero.hp) {
      hero.hp -= taken;
      continue;
    }
    const { seat, x, y } = hero;
    const level = levelOf(hero.xp);
    Object.assign(hero, {
      hp: 0,
      respawn: respawnSteps(level),
      cooldown: 0,
      goal: -1,
    });
    world.events.push({ type: "heroDeath", seat, killer, x, y });
    kills.push([
      killer,
      teamOf(seat),
      x,
      y,
      HERO_XP + HERO_XP_PER_LEVEL * level,
    ]);
  }
  world.units = world.units.filter((unit, index) => {
    const { taken, killer } = targets[index]!;
    unit.hp -= taken;
    if (unit.hp > 0) return true;
    const { id, kind, owner, x, y } = unit;
    world.events.push({ type: "death", id, kind, owner, x, y });
    kills.push([killer, teamOf(owner), x, y, KILL_XP[kind]]);
    engaged.delete(id);
    return false;
  });
  for (const [killer, team, x, y, xp] of kills)
    award(world, killer!, team!, x!, y!, xp!);
  world.winner = winnerOf(map, world.players, world.buildings);
  if (world.winner !== NO_WINNER)
    world.events.push({ type: "won", winner: world.winner });
  return engaged;
}
