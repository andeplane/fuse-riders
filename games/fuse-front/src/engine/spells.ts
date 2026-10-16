/**
 * Spells: a hero's four slots (Q, W, E, R) come from its kit, a table of plain data, so another hero is a new row of
 * `KITS` with effects drawn from `SPELL_EFFECTS`. Every hero is Brick until heroes are picked. `cast(slot, x, y)`
 * (`step.ts`) spends energy and starts the slot's cooldown when the hero is alive, has the level, the energy and a
 * ready slot; anything else does nothing. Brick's spells centre on Brick, so the aim point is checked but unused.
 *
 * - SHOCKWAVE: enemy robots within its radius are stunned (no shooting or seeking) and knocked back one tile.
 * - RALLY CRY: friendly robots within its radius reload `power` percent faster while it lasts.
 * - IRON HIDE (passive): the hero and friendly vehicles within its radius take `power` percent less damage.
 * - ORBITAL DROP: a light tank joins the owner's army on the tile the hero faces (or its own). It counts toward
 *   `UNIT_CAP` like any unit, so a player at the cap cannot cast it (nothing is spent).
 *
 * Durations and powers grow by their `PerLevel` amount for each level above 1. Timers count down at the start of
 * each step, so a cast made on step N is ready again on step N + cooldown.
 */
import { DIRS, openTile } from "./flow.js";
import { alive, levelOf } from "./hero.js";
import type { GameMap } from "./map.js";
import { div, isqrt } from "./math.js";
import { centreOf, settle, tileOf } from "./move.js";
import {
  MAX_LEVEL,
  STEPS_PER_SECOND,
  TILE,
  UNITS,
  UNIT_CAP,
  teamOf,
} from "./tuning.js";
import type { Hero, Unit, World } from "./world.js";

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
}

const s = (seconds: number): number => seconds * STEPS_PER_SECOND;
/** How much faster a rallied robot reloads, in percent. */
export const RALLY_PERCENT = 30;
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
  ...fields,
});

export const KITS: Readonly<Record<"brick", readonly Readonly<Spell>[]>> = {
  brick: [
    spell({
      name: "Shockwave",
      effect: "shockwave",
      cooldown: s(12),
      energy: 40,
      radius: 3 * TILE,
      duration: s(1.5),
      durationPerLevel: 2,
      power: TILE,
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
      cooldown: s(120),
      energy: 100,
    }),
  ],
};

/** A hero's spells by slot. */
export const kitOf = (_hero: Hero): readonly Readonly<Spell>[] => KITS.brick;

const scaled = (spell: Spell, level: number) => ({
  duration: spell.duration + spell.durationPerLevel * (level - 1),
  power: spell.power + spell.powerPerLevel * (level - 1),
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
  const { duration, power } = scaled(spell, level);
  const near = (unit: Unit): boolean => {
    const dx = unit.x - hero.x,
      dy = unit.y - hero.y;
    return dx * dx + dy * dy <= spell.radius * spell.radius;
  };
  if (spell.effect === "orbitalDrop") {
    let owned = 0;
    for (const unit of world.units) if (unit.owner === hero.seat) owned++;
    if (owned >= UNIT_CAP) return false;
    const [fx, fy] = DIRS[hero.facing]!;
    let [tx, ty] = [tileOf(hero.x) + fx, tileOf(hero.y) + fy];
    if (!openTile(map, tx, ty)) [tx, ty] = [tileOf(hero.x), tileOf(hero.y)];
    world.units.push({
      id: world.nextId++,
      kind: "lightTank",
      owner: hero.seat,
      x: centreOf(tx),
      y: centreOf(ty),
      hp: UNITS.lightTank.hp,
      cooldown: 0,
      goal: -1,
      stun: 0,
      rally: 0,
    });
  }
  for (const unit of world.units) {
    if (!UNITS[unit.kind].robot || !near(unit)) continue;
    const ally = teamOf(unit.owner) === team;
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
