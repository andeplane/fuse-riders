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
 *   and robots' small arms do only `HERO.smallArms` percent to it. A hero's shot on an enemy hero does `HERO.duel`
 *   percent. A hero that shoots or is hit is not calm.
 * - A wave unit's shot grows with its wave (`waves.ts`). A robot within `AURA_RADIUS` of its owner's living hero does
 *   `AURA_DAMAGE` percent damage. Spells (`spells.ts`): a
 *   stunned unit holds fire, a rallied one reloads faster, IRON HIDE cuts the damage a covered hero or vehicle takes,
 *   and no gun picks a CLOAKed hero.
 * - A kill is credited to the owner of the first shot (in shooter order: units by id, heroes by seat, turrets) that hit
 *   the victim this step, and its XP goes to the killing team's heroes near it (`award`), a razed lane structure's
 *   too (`STRUCTURE_XP`). A unit's killing blow, for gold, is the first hero's shot that hit
 *   it this step; a hero's hit on a hero counts toward an assist, and a razed lane structure pays its razer's team
 *   (`gold.ts`).
 * - Lane towers and gates (`towers.ts`) pick and ramp their own way, and a protected structure is never picked.
 * - Units at 0 hit points are removed, in id order; heroes at 0 wait to respawn (`hero.ts`). A turret or fort at 0
 *   stays as a ruin: it neither fires nor is targeted, and a team whose last fort falls loses (`winnerOf`).
 */
import { better } from "./focus.js";
import { alive, award, facingOf, fell, heroGun } from "./hero.js";
import type { GameMap } from "./map.js";
import { ceilDiv, div } from "./math.js";
import { RALLY_PERCENT, hideOf } from "./spells.js";
import { centreOf } from "./move.js";
import { laneMap, unitDamage } from "./waves.js";
import { aggro, rampUp, shielded } from "./towers.js";
import { upgrades } from "./jungle.js";
import { hurtBy, lastHit, towerGold } from "./gold.js";
import {
  AURA_DAMAGE,
  AURA_RADIUS,
  FORT_GUN,
  GRUNT_ARMOUR,
  HERO,
  KILL_XP,
  STRUCTURE_XP,
  TILE,
  TOWER,
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
  type Unit,
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
  /** The seat of the first hero whose shot hit it this step (-1 for none): a unit's killing blow, for gold. */
  striker: number;
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
  striker: -1,
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
    // A protected structure (`towers.ts`) still shoots, but no gun picks it.
    targets.push({
      ...target("building", building.id, x, y, owner, index),
      hidden: shielded(map, world, building),
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
  const nearest = (
    from: Target,
    range: number,
    accept: (target: Target) => boolean,
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
          if (!accept(target)) continue;
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
  /** The enemy that `of` (a `MARKS` index) and `id` name, while a gun at `from` may pick it within `range`. */
  const held = (from: Target, of: number, id: number, range: number) =>
    of < 0
      ? undefined
      : targets.find(
          (each) =>
            each.of === MARKS[of] &&
            each.id === id &&
            each.team !== from.team &&
            !each.hidden &&
            (each.x - from.x) * (each.x - from.x) +
              (each.y - from.y) * (each.y - from.y) <=
              range * range,
        );
  /** Hero shots that hit an enemy hero this step: the shooter and the victim, for the towers' aggro. */
  const duels: [Target, Target][] = [];
  const armoured = [0, 1].map(
    (team) => laneMap(map) && upgrades(map, world, team).armour,
  );
  /** A held robot factory armours its team's wave grunts against guns (`jungle.ts`). */
  const armour = (struck: Unit, team: number, damage: number): number =>
    struck.kind === "grunt" && struck.lane >= 0 && armoured[team]
      ? div(damage * (100 - GRUNT_ARMOUR), 100)
      : damage;
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
    if (from.of === "hero" && victim.striker < 0) victim.striker = from.owner;
    if (victim.of !== "hero") return;
    const struck = world.heroes[victim.index]!;
    struck.quiet = 0;
    if (from.of === "hero") hurtBy(struck, from.owner);
  };

  for (const from of targets) {
    const unit = from.of === "unit" ? world.units[from.index]! : undefined;
    const hero = from.of === "hero" ? world.heroes[from.index]! : undefined;
    const building =
      from.of === "building" ? world.buildings[from.index]! : undefined;
    const fort =
      building !== undefined && map.sites[building.id]!.kind === "fort";
    const tower = building !== undefined && map.sites[building.id]!.lane >= 0;
    const shooter = unit ?? hero ?? building!;
    const stats = unit
      ? UNITS[unit.kind]
      : hero
        ? heroGun(hero)
        : { ...(fort ? FORT_GUN : tower ? TOWER : TURRET), siege: 100 };
    if (shooter.cooldown > 0) shooter.cooldown--;
    // A stunned unit neither shoots nor stands to fight.
    if (unit !== undefined && unit.stun > 0) continue;
    // A hero shoots its focus (`focus.ts`) before anything nearer while it is in range; a tower keeps its target, else
    // takes the nearest unit, else the nearest hero (`towers.ts`).
    // A camp's neutral guards (`jungle.ts`) and the waves leave each other alone, and no structure shoots a guard.
    const guard = from.team < 0;
    const wave = unit !== undefined && unit.lane >= 0;
    const fits = (each: Target): boolean =>
      guard
        ? each.of === "hero" ||
          (each.of === "unit" && world.units[each.index]!.lane < 0)
        : (each.team >= 0 || (!wave && building === undefined)) &&
          (!fort || each.of !== "building");
    const victim = tower
      ? (held(from, building!.aimOf, building!.aim, stats.range) ??
        nearest(
          from,
          stats.range,
          (each) => each.of === "unit" && fits(each),
        ) ??
        nearest(from, stats.range, (each) => each.of === "hero"))
      : ((hero && held(from, hero.focusOf, hero.focus, stats.range)) ??
        nearest(from, stats.range, fits));
    // A tower with nothing to shoot lets its target go: the next one starts a new ramp.
    if (victim === undefined && tower)
      [building!.aimOf, building!.aim, building!.ramp] = [-1, -1, 0];
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
        // A camp's guards (`jungle.ts`) take splash only from a shot at their camp.
        if (near.team < 0 !== victim.team < 0) continue;
        const dx = near.x - victim.x,
          dy = near.y - victim.y;
        if (dx * dx + dy * dy > HERO.splash * HERO.splash) continue;
        const struck = world.units[near.index]!;
        const share = div(splash * hideOf(world, struck, near.team), 100);
        hit(near, from, armour(struck, near.team, share));
      }
    }
    if (tower) damage = rampUp(building!, victim, damage);
    if (hero !== undefined && victim.of === "hero") duels.push([from, victim]);
    // On a lane map a hero brings structures down at `TOWER.heroSiege` percent (`towers.ts`).
    const siege = hero && laneMap(map) ? TOWER.heroSiege : stats.siege;
    if (victim.of === "building") damage = div(damage * siege, 100);
    else {
      const struck = (victim.of === "hero" ? world.heroes : world.units)[
        victim.index
      ]!;
      if (victim.of === "hero" && robot)
        damage = div(damage * HERO.smallArms, 100);
      if (victim.of === "hero" && hero !== undefined)
        damage = div(damage * HERO.duel, 100);
      damage = div(damage * hideOf(world, struck, victim.team), 100);
      if (victim.of === "unit")
        damage = armour(world.units[victim.index]!, victim.team, damage);
    }
    hit(victim, from, damage);
    world.events.push({
      type: "shot",
      from: mark(from),
      to: mark(victim),
      damage,
    });
  }

  aggro(map, world, duels);
  // Deaths first, then XP, so a hero that falls this step earns no assist from it.
  const kills: number[][] = [];
  for (const { of, index, taken, killer } of targets) {
    if (taken === 0 || of === "unit") continue;
    if (of === "building") {
      const building = world.buildings[index]!;
      building.hp = taken >= building.hp ? 0 : building.hp - taken;
      if (building.hp > 0) continue;
      Object.assign(building, { cooldown: 0, aimOf: -1, aim: -1, ramp: 0 });
      const site = map.sites[building.id]!;
      const kind = site.kind;
      // A razed lane tower or gate pays its razer's team (`gold.ts`), and its XP those near it.
      if (site.lane >= 0) {
        towerGold(world, killer, site.tier);
        const [x, y] = [centreOf(site.x), centreOf(site.y)];
        kills.push([killer, site.team, x, y, STRUCTURE_XP[site.tier]!]);
      }
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
    const { taken, killer, striker } = targets[index]!;
    unit.hp -= taken;
    if (unit.hp > 0) return true;
    const { id, kind, owner, x, y } = unit;
    world.events.push({ type: "death", id, kind, owner, x, y });
    kills.push([killer, teamOf(owner), x, y, KILL_XP[kind]]);
    if (striker >= 0) lastHit(world, striker, kind, owner);
    engaged.delete(id);
    return false;
  });
  for (const [killer, team, x, y, xp] of kills)
    award(map, world, killer!, team!, x!, y!, xp!);
  world.winner = winnerOf(map, world.players, world.buildings);
  if (world.winner !== NO_WINNER)
    world.events.push({ type: "won", winner: world.winner });
  return { engaged, heroes };
}
