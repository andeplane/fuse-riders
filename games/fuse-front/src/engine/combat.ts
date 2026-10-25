/**
 * Combat, between goals and movement in a step. Every unit, living hero, turret and fort a seat holds takes the
 * nearest enemy in range: an enemy unit or hero, a turret held by the other team, or an enemy fort (factories are
 * captured, never shot; a fort's gun shoots only units and heroes). Ties go to units, then heroes, then buildings,
 * then the lower id. Targets are picked from where everything stood when the phase began and shots are instant hits
 * applied together, so the order units fire in cannot change who hits what.
 *
 * - A hero told to `attack` (`focus.ts`) shoots that target first whenever it is in range.
 * - A shooter fires when its cooldown is 0 and then waits its kind's `cooldown` steps; the timer counts down every step.
 * - A unit with a target in range stands still to fight (`moveUnits` skips its seek), even while reloading. A hero
 *   shoots whether it stands or walks; its shot splashes every other enemy unit within `HERO.splash` of the target,
 *   and robots' small arms do only `HERO.smallArms` percent to it. A hero that shoots or is hit is not calm.
 * - A wave unit's shot grows with its wave (`waves.ts`). A robot within `AURA_RADIUS` of its owner's living hero does
 *   `AURA_DAMAGE` percent damage. Spells (`spells.ts`): a
 *   stunned unit holds fire, a rallied one reloads faster, IRON HIDE cuts the damage a covered hero or vehicle takes,
 *   and no gun picks a CLOAKed hero.
 * - A kill is credited to the owner of the first shot (in shooter order: units by id, heroes by seat, turrets) that hit
 *   the victim this step, and earns XP (`award`).
 * - Units at 0 hit points are removed, in id order; heroes at 0 wait to respawn (`hero.ts`). A turret or fort at 0
 *   stays as a ruin: it neither fires nor is targeted, and a team whose last fort falls loses (`winnerOf`).
 */
import { better } from "./focus.js";
import { alive, award, facingOf, fell, heroShot, levelOf } from "./hero.js";
import type { GameMap } from "./map.js";
import { ceilDiv, div } from "./math.js";
import { RALLY_PERCENT, hideOf } from "./spells.js";
import { centreOf } from "./move.js";
import { unitDamage } from "./waves.js";
import {
  AURA_DAMAGE,
  AURA_RADIUS,
  FORT_GUN,
  HERO,
  KILL_XP,
  TILE,
  TURRET,
  UNITS,
  teamOf,
} from "./tuning.js";
import {
  MARKS,
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
  /** A CLOAKed hero (`spells.ts`): no gun picks it as a target. */
  hidden?: boolean;
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

const mark = ({ of, id, x, y }: Mark): Mark => ({ of, id, x, y });

/**
 * Fires every ready shooter and applies the result; returns the ids of units that stand to fight this step and the
 * seats of heroes with an enemy in range.
 */
export function fight(
  map: GameMap,
  world: World,
): { engaged: Set<number>; heroes: Set<number> } {
  const engaged = new Set<number>();
  const heroes = new Set<number>();
  // Units first, in order, so `targets[index]` is `world.units[index]`'s.
  const targets: Target[] = world.units.map((unit, index) =>
    target("unit", unit.id, unit.x, unit.y, unit.owner, index),
  );
  for (const [index, hero] of world.heroes.entries())
    if (alive(hero))
      targets.push({
        ...target("hero", hero.seat, hero.x, hero.y, hero.seat, index),
        hidden: hero.cloak > 0,
      });
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
  const nearest = (
    from: Target,
    range: number,
    buildings: boolean,
  ): Target | undefined => {
    const reach = ceilDiv(range, CELL);
    const cx = div(from.x, CELL),
      cy = div(from.y, CELL);
    let best: Target | undefined,
      bestD = 0;
    for (let y = cy - reach; y <= cy + reach; y++)
      for (let x = cx - reach; x <= cx + reach; x++) {
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
        for (const target of cells.get(y * columns + x) ?? NO_TARGETS) {
          if (target.team === from.team || target.hidden) continue;
          if (!buildings && target.of === "building") continue;
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

  /** A shot lands: its damage counts at the end of the phase, and a hero hit is no longer calm. */
  const hit = (victim: Target, from: Target, damage: number): void => {
    victim.taken += damage;
    if (victim.killer < 0) victim.killer = from.owner;
    if (victim.of === "hero") world.heroes[victim.index]!.quiet = 0;
  };

  for (const from of targets) {
    const unit = from.of === "unit" ? world.units[from.index]! : undefined;
    const hero = from.of === "hero" ? world.heroes[from.index]! : undefined;
    const building =
      from.of === "building" ? world.buildings[from.index]! : undefined;
    const fort =
      building !== undefined && map.sites[building.id]!.kind === "fort";
    const shooter = unit ?? hero ?? building!;
    const stats = unit
      ? UNITS[unit.kind]
      : hero
        ? heroShot(levelOf(hero.xp), hero.kind)
        : { ...(fort ? FORT_GUN : TURRET), siege: 100 };
    if (shooter.cooldown > 0) shooter.cooldown--;
    // A stunned unit neither shoots nor stands to fight.
    if (unit !== undefined && unit.stun > 0) continue;
    // A hero shoots its focus (`focus.ts`) before anything nearer while it is in range.
    const focus =
      hero !== undefined && hero.focusOf >= 0
        ? targets.find(
            (each) =>
              each.of === MARKS[hero.focusOf] &&
              each.id === hero.focus &&
              each.team !== from.team &&
              !each.hidden &&
              (each.x - from.x) * (each.x - from.x) +
                (each.y - from.y) * (each.y - from.y) <=
                stats.range * stats.range,
          )
        : undefined;
    const victim = focus ?? nearest(from, stats.range, !fort);
    if (victim === undefined) continue;
    if (unit !== undefined) engaged.add(unit.id);
    if (hero !== undefined) heroes.add(hero.seat);
    if (shooter.cooldown > 0) continue;
    shooter.cooldown =
      unit !== undefined && unit.rally > 0
        ? div(stats.cooldown * 100, 100 + RALLY_PERCENT)
        : stats.cooldown;
    let damage = unit !== undefined ? unitDamage(unit) : stats.damage;
    const robot = unit !== undefined && UNITS[unit.kind].robot;
    if (robot && inAura(from)) damage = div(damage * AURA_DAMAGE, 100);
    if (hero !== undefined) {
      hero.facing = facingOf(victim.x - hero.x, victim.y - hero.y, hero.facing);
      hero.quiet = 0;
      // The splash: every other enemy unit near the target, in id order, takes part of the shot.
      const splash = div(damage * HERO.splashPercent, 100);
      for (const near of targets) {
        if (near.of !== "unit" || near === victim) continue;
        if (near.team === from.team) continue;
        const dx = near.x - victim.x,
          dy = near.y - victim.y;
        if (dx * dx + dy * dy > HERO.splash * HERO.splash) continue;
        const struck = world.units[near.index]!;
        hit(near, from, div(splash * hideOf(world, struck, near.team), 100));
      }
    }
    if (victim.of === "building") damage = div(damage * stats.siege, 100);
    else {
      const struck = (victim.of === "hero" ? world.heroes : world.units)[
        victim.index
      ]!;
      if (victim.of === "hero" && robot)
        damage = div(damage * HERO.smallArms, 100);
      damage = div(damage * hideOf(world, struck, victim.team), 100);
    }
    hit(victim, from, damage);
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
    kills.push([killer, teamOf(seat), x, y, fell(world, hero, killer)]);
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
  return { engaged, heroes };
}
