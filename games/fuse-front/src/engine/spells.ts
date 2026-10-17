/**
 * Spells: a hero's four slots (Q, W, E, R) come from its kind's kit, a table of plain data, so another hero is a new
 * row of `KITS` with effects drawn from `SPELL_EFFECTS`. `cast(slot, x, y)` (`step.ts`) spends energy and starts the
 * slot's cooldown when the hero is alive, has the level, the energy and a ready slot, and the spell finds what it
 * needs; anything else does nothing and spends nothing. A spell's `targeting` says what the aim tile means: `self`
 * ignores it; `point` aims at the tile (within `range` of the hero); `unit` acts on what stands nearest the aim
 * tile, within `radius` of it and `range` of the hero (a tie goes to units, then heroes, then the lower id).
 *
 * Brick, frontline:
 * - SHOCKWAVE: enemy units within its radius take `damage` (less IRON HIDE's share); the robots among them are also stunned (no shooting or
 *   seeking) and knocked back one tile. Units it kills die at once, credited to the caster.
 * - RALLY CRY: friendly robots within its radius reload `power` percent faster and walk `RALLY_SPEED` percent faster
 *   while it lasts.
 * - IRON HIDE (passive): the hero and friendly vehicles within its radius take `power` percent less damage.
 * - ORBITAL DROP: a heavily armoured light tank (`DROP_HP` hit points) joins the owner's army on the tile the hero
 *   faces, or its own when that tile is blocked or lies across a rock's corner. It counts toward the owner's
 *   `unitCap` like any unit, so a player at the cap cannot cast it (nothing is spent).
 *
 * Vix, infiltrator:
 * - SNIPE (unit): an enemy unit or uncloaked hero takes `damage`; a tank takes `power` percent of it.
 * - CLOAK: for its duration nothing picks Vix as a target (guns or SNIPE), and a flag Vix takes raises no alert.
 * - STICKY MINE (point): a charge on the aim tile (Vix's own when that is out of range or blocked) that lasts its
 *   duration. The first enemy tank within its radius carries it off, and `MINE_FUSE` steps later it does `damage` to
 *   that tank. A seat keeps `MINES_PER_HERO`; laying another removes its oldest.
 * - HIJACK (unit): an enemy light tank changes sides to Vix's owner, unless that owner is at its `unitCap`.
 *
 * Durations, powers and damage grow by their `PerLevel` amount for each level above 1. Timers count down at the start
 * of each step, so a cast made on step N is ready again on step N + cooldown.
 */
import { DIRS, openTile } from "./flow.js";
import { alive, award, fell, levelOf } from "./hero.js";
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
  type HeroKind,
} from "./tuning.js";
import { unitCap, type Hero, type Unit, type World } from "./world.js";

export const SPELL_EFFECTS = [
  "shockwave",
  "rally",
  "ironHide",
  "orbitalDrop",
  "snipe",
  "cloak",
  "stickyMine",
  "hijack",
] as const;
export type SpellEffect = (typeof SPELL_EFFECTS)[number];

export interface Spell {
  name: string;
  effect: SpellEffect;
  /** What the aim tile means (see above). */
  targeting: "self" | "point" | "unit";
  /** A passive is always on from its unlock level and cannot be cast. */
  passive: boolean;
  unlock: number;
  /** Steps. */
  cooldown: number;
  energy: number;
  /** Sub-pixels: how far from the hero it may aim (0 for `self`), and its area. */
  range: number;
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
/** Steps a STICKY MINE rides its tank before it goes off, and the mines a seat keeps at once. */
export const MINE_FUSE = s(1);
export const MINES_PER_HERO = 3;
const spell = (
  fields: Partial<Spell> & Pick<Spell, "name" | "effect">,
): Spell => ({
  targeting: "self",
  passive: false,
  unlock: 1,
  cooldown: 0,
  energy: 0,
  range: 0,
  radius: 0,
  duration: 0,
  durationPerLevel: 0,
  power: 0,
  powerPerLevel: 0,
  damage: 0,
  damagePerLevel: 0,
  ...fields,
});

export const KITS: Readonly<Record<HeroKind, readonly Readonly<Spell>[]>> = {
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
  // prettier-ignore
  vix: [
    spell({ name: "Snipe", effect: "snipe", targeting: "unit", cooldown: s(8), energy: 35, range: 12 * TILE,
      radius: 3 * TILE, power: 300, damage: 140, damagePerLevel: 20 }),
    spell({ name: "Cloak", effect: "cloak", cooldown: s(18), energy: 40, duration: s(5) }),
    spell({ name: "Sticky Mine", effect: "stickyMine", targeting: "point", cooldown: s(6), energy: 30,
      range: 3 * TILE, radius: TILE, duration: s(60), damage: 220, damagePerLevel: 30 }),
    spell({ name: "Hijack", effect: "hijack", targeting: "unit", unlock: 6, energy: 100, cooldown: s(60),
      range: 6 * TILE, radius: 3 * TILE }),
  ],
};

/** A hero's spells by slot. */
export const kitOf = (hero: Hero): readonly Readonly<Spell>[] =>
  KITS[hero.kind];
/** Whether `kind`'s kit has a spell with `effect`. */
export const kitHas = (kind: HeroKind, effect: SpellEffect): boolean =>
  KITS[kind].some((each) => each.effect === effect);

export const scaled = (spell: Spell, level: number) => ({
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

const MINE = KITS.vix[2]!;

const within = (a: Spot, b: Spot, r: number): boolean =>
  (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) <= r * r;
interface Spot {
  x: number;
  y: number;
}

/** Removes the units at 0 hit points in id order, each a death that earns `killer`'s hero its XP. */
function bury(world: World, killer: number): void {
  world.units = world.units.filter((unit) => {
    if (unit.hp > 0) return true;
    const { id, kind, owner, x, y } = unit;
    world.events.push({ type: "death", id, kind, owner, x, y });
    award(world, killer, teamOf(owner), x, y, KILL_XP[kind]);
    return false;
  });
}

/** The start of a step: spell cooldowns and statuses count down. */
export function tickSpells(world: World): void {
  for (const hero of world.heroes) {
    hero.spells = hero.spells.map((left) => (left > 0 ? left - 1 : 0));
    if (hero.cloak > 0) hero.cloak--;
  }
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

type Target = { of: "unit"; at: Unit } | { of: "hero"; at: Hero };

/**
 * A `unit` spell's target among `candidates` (units, then heroes, each in id order): the one nearest the aim within
 * `range` of the hero and `radius` of the aim; the first listed wins a tie.
 */
function pick(
  hero: Hero,
  aim: Spot,
  spell: Spell,
  candidates: readonly Target[],
): Target | undefined {
  let best: Target | undefined,
    bestD = 0;
  for (const each of candidates) {
    const { x, y } = each.at;
    if (!within(each.at, hero, spell.range)) continue;
    if (!within(each.at, aim, spell.radius)) continue;
    const d = (x - aim.x) * (x - aim.x) + (y - aim.y) * (y - aim.y);
    if (best === undefined || d < bestD) [best, bestD] = [each, d];
  }
  return best;
}

/** Casts `hero`'s slot `slot` aimed at tile (`tx`, `ty`) if it can be cast; returns whether it was. */
export function cast(
  map: GameMap,
  world: World,
  hero: Hero,
  slot: number,
  tx = tileOf(hero.x),
  ty = tileOf(hero.y),
): boolean {
  const spell = kitOf(hero)[slot];
  const level = levelOf(hero.xp);
  if (spell === undefined || spell.passive || !alive(hero)) return false;
  if (level < spell.unlock || hero.spells[slot]! > 0) return false;
  if (hero.energy < spell.energy) return false;
  const { seat } = hero;
  const team = teamOf(seat);
  const { duration, power, damage } = scaled(spell, level);
  const aim = { x: centreOf(tx), y: centreOf(ty) };
  let owned = 0;
  for (const unit of world.units) if (unit.owner === seat) owned++;
  const enemies: Target[] = world.units
    .filter((unit) => teamOf(unit.owner) !== team)
    .map((at) => ({ of: "unit", at }));
  const near = (unit: Unit): boolean => {
    const dx = unit.x - hero.x,
      dy = unit.y - hero.y;
    return dx * dx + dy * dy <= spell.radius * spell.radius;
  };
  if (spell.effect === "snipe") {
    const heroes = world.heroes
      .filter((h) => teamOf(h.seat) !== team && alive(h) && h.cloak === 0)
      .map((at): Target => ({ of: "hero", at }));
    const target = pick(hero, aim, spell, [...enemies, ...heroes]);
    if (target === undefined) return false;
    if (target.of === "unit") {
      const unit = target.at;
      const hit = UNITS[unit.kind].robot ? damage : div(damage * power, 100);
      unit.hp -= div(hit * hideOf(world, unit, teamOf(unit.owner)), 100);
    } else {
      const victim = target.at;
      const foe = teamOf(victim.seat);
      const hit = div(damage * hideOf(world, victim, foe), 100);
      victim.quiet = 0;
      if (hit < victim.hp) victim.hp -= hit;
      else
        award(world, seat, foe, victim.x, victim.y, fell(world, victim, seat));
    }
  } else if (spell.effect === "cloak") hero.cloak = duration;
  else if (spell.effect === "stickyMine") {
    const there = within(aim, hero, spell.range) && openTile(map, tx, ty);
    const [mx, my] = there ? [tx, ty] : [tileOf(hero.x), tileOf(hero.y)];
    const laid = world.mines.filter((each) => each.owner === seat);
    if (laid.length >= MINES_PER_HERO)
      world.mines.splice(world.mines.indexOf(laid[0]!), 1);
    const [x, y] = [centreOf(mx), centreOf(my)];
    world.mines.push({ owner: seat, x, y, life: duration, stuck: -1 });
  } else if (spell.effect === "hijack") {
    const tanks = enemies.filter((each) => each.at.kind === "lightTank");
    const target =
      owned < unitCap(world, seat) && pick(hero, aim, spell, tanks);
    if (!target) return false;
    Object.assign(target.at, { owner: seat, goal: -1, stun: 0, rally: 0 });
  } else if (spell.effect === "orbitalDrop") {
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
  bury(world, seat);
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

/**
 * After movement: an armed STICKY MINE sticks to the first enemy tank (by id) within its radius, and a stuck one
 * rides its tank and goes off when its fuse ends, for its layer's current `damage`; a spent one goes. A mine whose
 * tank died or changed sides fizzles.
 */
export function tickMines(world: World): void {
  const kept = [];
  for (const mine of world.mines) {
    const enemy = (unit: Unit) => teamOf(unit.owner) !== teamOf(mine.owner);
    mine.life--;
    if (mine.stuck < 0) {
      if (mine.life <= 0) continue;
      const tank = world.units.find(
        (u) =>
          u.kind === "lightTank" && enemy(u) && within(u, mine, MINE.radius),
      );
      if (tank !== undefined)
        Object.assign(mine, {
          stuck: tank.id,
          life: MINE_FUSE,
          x: tank.x,
          y: tank.y,
        });
      kept.push(mine);
      continue;
    }
    const tank = world.units.find((u) => u.id === mine.stuck);
    if (tank === undefined || !enemy(tank)) continue;
    [mine.x, mine.y] = [tank.x, tank.y];
    if (mine.life > 0) {
      kept.push(mine);
      continue;
    }
    const layer = world.heroes.find((each) => each.seat === mine.owner)!;
    const { damage } = scaled(MINE, levelOf(layer.xp));
    tank.hp -= div(damage * hideOf(world, tank, teamOf(tank.owner)), 100);
    world.events.push({ type: "mine", seat: mine.owner, x: tank.x, y: tank.y });
    bury(world, mine.owner);
  }
  world.mines = kept;
}
