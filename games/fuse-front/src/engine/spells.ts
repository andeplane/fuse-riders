/**
 * Spells: a hero's four slots (Q, W, E, R) come from its kit, a table of plain data, so another hero is a new row of
 * `KITS` with effects drawn from `SPELL_EFFECTS`. Every hero is Brick until heroes are picked. `cast(slot, x, y)`
 * (`step.ts`) spends energy and starts the slot's cooldown when the hero is alive, has the level, the energy and a
 * ready slot; anything else does nothing. Brick's spells centre on Brick, so the aim point is checked but unused.
 *
 * - SHOCKWAVE: enemy units within its radius take `damage` (less IRON HIDE's share); the robots among them are also stunned (no shooting or
 *   seeking) and knocked back one tile. Units it kills die at once, credited to the caster.
 * - RALLY CRY: friendly robots within its radius reload `power` percent faster and walk `RALLY_SPEED` percent faster
 *   while it lasts.
 * - IRON HIDE (passive): the hero and friendly vehicles within its radius take `power` percent less damage.
 * - ORBITAL DROP: a heavily armoured light tank (`DROP_HP` hit points) joins the owner's army on the tile the hero
 *   faces, or its own when that tile is blocked or lies across a rock's corner. It counts toward the owner's
 *   `unitCap` like any unit, so a player at the cap cannot cast it (nothing is spent).
 *
 * Durations, powers and damage grow by their `PerLevel` amount for each level above 1. Timers count down at the start
 * of each step, so a cast made on step N is ready again on step N + cooldown.
 */
import { DIRS, openTile } from "./flow.js";
import { alive, award, levelOf } from "./hero.js";
import type { GameMap } from "./map.js";
import { div, isqrt } from "./math.js";
import { centreOf, settle, tileOf } from "./move.js";
import {
  KILL_XP,
  MAX_LEVEL,
  STEPS_PER_SECOND,
  TILE,
  UNITS,
  teamOf,
} from "./tuning.js";
import { unitCap, type Hero, type Unit, type World } from "./world.js";

export const SPELL_EFFECTS = [
  "shockwave",
  "rally",
  "ironHide",
  "orbitalDrop",
] as const;
export type SpellEffect = (typeof SPELL_EFFECTS)[number];

export interface Spell {
  name: string;
  effect: SpellEffect;
  /** A passive is always on from its unlock level and cannot be cast. */
  passive: boolean;
  unlock: number;
  /** Steps. */
  cooldown: number;
  energy: number;
  /** Sub-pixels. */
  radius: number;
  /** Steps a status lasts. */
  duration: number;
  durationPerLevel: number;
  /** Percent, or for a knockback sub-pixels (at most a tile, so nothing is pushed through a wall). */
  power: number;
  powerPerLevel: number;
  /** Hit points it takes from each enemy unit it reaches. */
  damage: number;
  damagePerLevel: number;
}

const s = (seconds: number): number => seconds * STEPS_PER_SECOND;
/** How much faster a rallied robot reloads, in percent (it walks `RALLY_SPEED` percent faster, `move.ts`). */
export const RALLY_PERCENT = 50;
/** An Orbital Drop tank's hit points: it lands far tougher than a factory's. */
export const DROP_HP = 650;
const spell = (fields: Partial<Spell> & Pick<Spell, "name" | "effect">) => ({
  passive: false,
  unlock: 1,
  cooldown: 0,
  energy: 0,
  radius: 0,
  duration: 0,
  durationPerLevel: 0,
  power: 0,
  powerPerLevel: 0,
  damage: 0,
  damagePerLevel: 0,
  ...fields,
});

export const KITS: Readonly<Record<"brick", readonly Readonly<Spell>[]>> = {
  brick: [
    spell({
      name: "Shockwave",
      effect: "shockwave",
      cooldown: s(10),
      energy: 40,
      radius: 3 * TILE,
      duration: s(2),
      durationPerLevel: 2,
      power: TILE,
      damage: 70,
      damagePerLevel: 12,
    }),
    spell({
      name: "Rally Cry",
      effect: "rally",
      cooldown: s(20),
      energy: 60,
      radius: 8 * TILE,
      duration: s(6),
      durationPerLevel: s(0.5),
      power: RALLY_PERCENT,
    }),
    spell({
      name: "Iron Hide",
      effect: "ironHide",
      passive: true,
      radius: 6 * TILE,
      power: 15,
      powerPerLevel: 1,
    }),
    spell({
      name: "Orbital Drop",
      effect: "orbitalDrop",
      unlock: 6,
      cooldown: s(90),
      energy: 100,
    }),
  ],
};

/** A hero's spells by slot. */
export const kitOf = (_hero: Hero): readonly Readonly<Spell>[] => KITS.brick;

const scaled = (spell: Spell, level: number) => ({
  duration: spell.duration + spell.durationPerLevel * (level - 1),
  power: spell.power + spell.powerPerLevel * (level - 1),
  damage: spell.damage + spell.damagePerLevel * (level - 1),
});

/** The longest a status of `effect` can last, for checkpoint validation. */
export function longest(effect: SpellEffect): number {
  let most = 0;
  for (const kit of Object.values(KITS))
    for (const each of kit)
      if (each.effect === effect && scaled(each, MAX_LEVEL).duration > most)
        most = scaled(each, MAX_LEVEL).duration;
  return most;
}

/** The start of a step: spell cooldowns and unit statuses count down. */
export function tickSpells(world: World): void {
  for (const hero of world.heroes)
    hero.spells = hero.spells.map((left) => (left > 0 ? left - 1 : 0));
  for (const unit of world.units) {
    if (unit.stun > 0) unit.stun--;
    if (unit.rally > 0) unit.rally--;
  }
}

/**
 * The percent of damage a hit on a hero or unit of `team` at (x, y) still does under IRON HIDE: a hero's own hide
 * covers it, and the strongest hide of a living teammate hero within its radius covers a vehicle.
 */
export function hideOf(
  world: World,
  victim: Hero | Unit,
  team: number,
): number {
  let best = 0;
  for (const hero of world.heroes) {
    if (!alive(hero) || teamOf(hero.seat) !== team) continue;
    const self = "seat" in victim && victim.seat === hero.seat;
    if (!self && ("seat" in victim || UNITS[victim.kind].robot)) continue;
    const level = levelOf(hero.xp);
    for (const each of kitOf(hero)) {
      if (each.effect !== "ironHide" || level < each.unlock) continue;
      const dx = victim.x - hero.x,
        dy = victim.y - hero.y;
      if (!self && dx * dx + dy * dy > each.radius * each.radius) continue;
      const power = scaled(each, level).power;
      if (power > best) best = power;
    }
  }
  return 100 - best;
}

/** Casts `hero`'s slot `slot` if it can be cast; returns whether it was. */
export function cast(
  map: GameMap,
  world: World,
  hero: Hero,
  slot: number,
): boolean {
  const spell = kitOf(hero)[slot];
  const level = levelOf(hero.xp);
  if (spell === undefined || spell.passive || !alive(hero)) return false;
  if (level < spell.unlock || hero.spells[slot]! > 0) return false;
  if (hero.energy < spell.energy) return false;
  const team = teamOf(hero.seat);
  const { duration, power, damage } = scaled(spell, level);
  const near = (unit: Unit): boolean => {
    const dx = unit.x - hero.x,
      dy = unit.y - hero.y;
    return dx * dx + dy * dy <= spell.radius * spell.radius;
  };
  if (spell.effect === "orbitalDrop") {
    let owned = 0;
    for (const unit of world.units) if (unit.owner === hero.seat) owned++;
    if (owned >= unitCap(world, hero.seat)) return false;
    const [fx, fy] = DIRS[hero.facing]!;
    const [hx, hy] = [tileOf(hero.x), tileOf(hero.y)];
    let [tx, ty] = [hx + fx, hy + fy];
    // The faced tile must be open and, across a diagonal, reachable without cutting a rock's corner.
    const reachable =
      openTile(map, tx, ty) &&
      (fx === 0 ||
        fy === 0 ||
        (openTile(map, tx, hy) && openTile(map, hx, ty)));
    if (!reachable) [tx, ty] = [hx, hy];
    world.units.push({
      id: world.nextId++,
      kind: "lightTank",
      owner: hero.seat,
      x: centreOf(tx),
      y: centreOf(ty),
      hp: DROP_HP,
      cooldown: 0,
      goal: -1,
      stun: 0,
      rally: 0,
    });
  }
  for (const unit of world.units) {
    if (!near(unit)) continue;
    const ally = teamOf(unit.owner) === team;
    if (spell.effect === "shockwave" && !ally)
      unit.hp -= div(damage * hideOf(world, unit, teamOf(unit.owner)), 100);
    if (!UNITS[unit.kind].robot) continue;
    if (spell.effect === "rally" && ally)
      unit.rally = unit.rally > duration ? unit.rally : duration;
    if (spell.effect !== "shockwave" || ally) continue;
    unit.stun = unit.stun > duration ? unit.stun : duration;
    let dx = unit.x - hero.x,
      dy = unit.y - hero.y;
    const length = isqrt(dx * dx + dy * dy);
    const [ex, ey] = DIRS[unit.id % DIRS.length]!;
    if (length === 0) [dx, dy] = [ex * power, ey * power];
    else [dx, dy] = [div(dx * power, length), div(dy * power, length)];
    [unit.x, unit.y] = settle(map, unit.x, unit.y, unit.x + dx, unit.y + dy);
  }
  // Units the spell killed die now, in id order, and earn the caster their XP.
  world.units = world.units.filter((unit) => {
    if (unit.hp > 0) return true;
    const { id, kind, owner, x, y } = unit;
    world.events.push({ type: "death", id, kind, owner, x, y });
    award(world, hero.seat, teamOf(owner), x, y, KILL_XP[kind]);
    return false;
  });
  hero.energy -= spell.energy;
  hero.spells[slot] = spell.cooldown;
  world.events.push({
    type: "cast",
    seat: hero.seat,
    slot,
    effect: spell.effect,
    x: hero.x,
    y: hero.y,
  });
  return true;
}
