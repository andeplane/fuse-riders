/**
 * Spells: a hero's four slots (Q, W, E, R) come from its kind's kit, a table of plain data, so another hero is a new
 * row of `KITS` with effects drawn from `SPELL_EFFECTS`. `cast(slot, x, y)` (`step.ts`) spends energy and starts the
 * slot's cooldown when the hero is alive, has the level, the energy and a ready slot, and the spell finds what it
 * needs; anything else does nothing and spends nothing. A spell's `targeting` says what the aim tile means: `self`
 * ignores it; `point` aims at the tile, refused beyond `range` (plus `AIM_SLACK`) of the hero; `unit` acts on the chosen target
 * (`Chosen`, within `range` plus `AIM_SLACK`), or without one on what stands nearest the aim
 * tile, within `radius` of it and `range` of the hero (a tie goes to units, then heroes, then buildings, then the
 * lower id).
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
 * - STICKY MINE (point): a charge on the aim tile (an open one in range) that lasts its
 *   duration. The first enemy tank within its radius carries it off, and `MINE_FUSE` steps later it does `damage` to
 *   that tank. A seat keeps `MINES_PER_HERO`; laying another removes its oldest.
 * - HIJACK (unit): an enemy light tank changes sides to Vix's owner, unless that owner is at its `unitCap`.
 *
 * Rivet, engineer:
 * - REPAIR BEAM (unit): a damaged friendly unit, hero or building heals `power` hit points, up to its most. A ruined
 *   turret in a sector the team holds counts, and stands again with what it healed; a ruined fort never does.
 * - TURRET DROP: a sentry (`UNITS.sentry`) on the faced tile, placed as ORBITAL DROP's tank. It never moves and burns
 *   out (`SENTRY_DECAY`); it counts toward the `unitCap`, and a seat keeps at most `SENTRIES_PER_HERO`.
 * - FORTIFY FLAG: the team's flag of the sector Rivet stands in, within its radius, cannot change hands while it lasts.
 * - OVERCLOCK (level 6): the team's factories build at `power` percent of their rate while it lasts.
 *
 * Tally, scout:
 * - DASH (point): up to `range` toward the aim tile (along its facing when aimed at its own), stopping at a wall.
 *   Heroes are never stunned, so there is nothing for it to break.
 * - FLARE (point): marks the aim tile for its duration; the owner's robots on PUSH make for it (`move.ts`).
 * - SPOTTER (passive): enemy units and heroes within its radius take `power` percent more damage.
 * - BLITZ (level 6): for its duration the owner's robots in the sector Tally stands in walk `BLITZ_SPEED` percent
 *   faster (`move.ts`). A flag falls the step a robot reaches it, so faster walking is faster capture.
 *
 * Durations, powers and damage grow by their `PerLevel` amount for each level above 1. Timers count down at the start
 * of each step, so a cast made on step N is ready again on step N + cooldown.
 */
import { DIRS, openTile } from "./flow.js";
import { alive, award, fell, levelOf, maxHp } from "./hero.js";
import { hurtBy, lastHit } from "./gold.js";
import type { GameMap } from "./map.js";
import { laneMap, waveHp } from "./waves.js";
import { div, isqrt } from "./math.js";
import { FLARE, centreOf, settle, tileOf } from "./move.js";
import {
  AIM_SLACK,
  BLITZ_SPEED,
  BUILDING_HP,
  KILL_XP,
  MAX_LEVEL,
  SENTRY_DECAY,
  STEPS_PER_SECOND,
  TILE,
  UNITS,
  teamOf,
  type HeroKind,
} from "./tuning.js";
import {
  MARKS,
  NEUTRAL,
  ownerOf,
  siteHp,
  unitCap,
  type Building,
  type Hero,
  type Unit,
  type World,
} from "./world.js";

export const SPELL_EFFECTS = [
  "shockwave",
  "rally",
  "ironHide",
  "orbitalDrop",
  "snipe",
  "cloak",
  "stickyMine",
  "hijack",
  "repair",
  "turretDrop",
  "fortify",
  "overclock",
  "dash",
  "flare",
  "spotter",
  "blitz",
] as const;
export type SpellEffect = (typeof SPELL_EFFECTS)[number];

/** Each effect's one line for the HUD's tooltips. */
const DESCRIPTIONS: Readonly<Record<SpellEffect, string>> = {
  shockwave: "Damages, stuns and knocks back enemy units around Brick.",
  rally: "Nearby robots reload and walk faster for a while.",
  ironHide: "Passive: Brick and nearby vehicles take less damage.",
  orbitalDrop: "Drops a heavily armoured light tank beside Brick.",
  snipe: "A long shot at one enemy unit or hero; tanks take less.",
  cloak: "Vix cannot be targeted, and takes flags without an alert.",
  stickyMine: "Lays a mine that sticks to the next enemy tank and blows.",
  hijack: "An enemy light tank switches to your side.",
  repair: "Heals a friendly unit, hero or building, even a ruined turret.",
  turretDrop: "Places a sentry gun beside Rivet that burns out over time.",
  fortify: "The flag Rivet stands by cannot change hands for a while.",
  overclock: "Your team's factories build twice as fast for a while.",
  dash: "Tally dashes toward the aimed spot, stopping at walls.",
  flare: "Marks a spot your pushing robots make for.",
  spotter: "Passive: enemies near Tally take more damage.",
  blitz: "Your robots in Tally's sector walk faster for a while.",
};

export interface Spell {
  name: string;
  effect: SpellEffect;
  /** One line on what it does, for tooltips. */
  desc: string;
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
  /** Percent, for a knockback sub-pixels (at most a tile, so nothing is pushed through a wall), or hit points healed. */
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
/** The sentries a seat keeps at once, and the production clock under OVERCLOCK in percent (`productionRate`). */
export const SENTRIES_PER_HERO = 2;
export const OVERCLOCK_PERCENT = 200;
const spell = (
  fields: Partial<Spell> & Pick<Spell, "name" | "effect">,
): Spell => ({
  desc: DESCRIPTIONS[fields.effect],
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
  // prettier-ignore
  rivet: [
    spell({ name: "Repair Beam", effect: "repair", targeting: "unit", cooldown: s(6), energy: 30, range: 6 * TILE,
      radius: 4 * TILE, power: 160, powerPerLevel: 25 }),
    spell({ name: "Turret Drop", effect: "turretDrop", cooldown: s(20), energy: 50 }),
    spell({ name: "Fortify Flag", effect: "fortify", cooldown: s(25), energy: 40, radius: 3 * TILE, duration: s(10),
      durationPerLevel: s(1) }),
    spell({ name: "Overclock", effect: "overclock", unlock: 6, energy: 100, cooldown: s(75), duration: s(15),
      power: OVERCLOCK_PERCENT }),
  ],
  // prettier-ignore
  tally: [
    spell({ name: "Dash", effect: "dash", targeting: "point", cooldown: s(6), energy: 25, range: 4 * TILE }),
    spell({ name: "Flare", effect: "flare", targeting: "point", cooldown: s(15), energy: 35, range: 10 * TILE,
      duration: s(10) }),
    spell({ name: "Spotter", effect: "spotter", passive: true, radius: 5 * TILE, power: 10, powerPerLevel: 1 }),
    spell({ name: "Blitz", effect: "blitz", unlock: 6, energy: 100, cooldown: s(60), duration: s(10),
      power: BLITZ_SPEED }),
  ],
};

// Frozen, so a view can share the rows (`SPELL_INFO`).
for (const kit of Object.values(KITS))
  for (const row of kit) Object.freeze(row);

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

/** A unit's most hit points: its wave's (`waves.ts`), or an Orbital Drop tank's while it is above a factory tank's. */
export const unitMax = (unit: Unit): number =>
  unit.wave > 0
    ? waveHp(unit.kind, unit.wave)
    : unit.hp > UNITS[unit.kind].hp
      ? DROP_HP
      : UNITS[unit.kind].hp;

/** Removes the units at 0 hit points in id order, each a death that earns `killer`'s hero its XP and gold (none for -1). */
function bury(world: World, killer: number): void {
  world.units = world.units.filter((unit) => {
    if (unit.hp > 0) return true;
    const { id, kind, owner, x, y } = unit;
    world.events.push({ type: "death", id, kind, owner, x, y });
    if (killer < 0) return false;
    award(world, killer, teamOf(owner), x, y, KILL_XP[kind]);
    // A spell or mine is its hero's own killing blow (`gold.ts`).
    lastHit(world, killer, kind, owner);
    return false;
  });
}

/**
 * The start of a step: spell cooldowns and statuses count down, an expired FLARE releases the robots it drew, and
 * sentries burn out.
 */
export function tickSpells(world: World): void {
  const down = (left: number): number => (left > 0 ? left - 1 : 0);
  for (const hero of world.heroes) {
    hero.spells = hero.spells.map(down);
    [hero.cloak, hero.blitz] = [down(hero.cloak), down(hero.blitz)];
    if (hero.flareLeft > 0 && --hero.flareLeft === 0) {
      hero.flare = -1;
      for (const unit of world.units)
        if (unit.owner === hero.seat && unit.goal === FLARE) unit.goal = -1;
    }
  }
  world.fortified = world.fortified.map(down);
  world.overclock = world.overclock.map(down);
  for (const unit of world.units) {
    if (unit.stun > 0) unit.stun--;
    if (unit.rally > 0) unit.rally--;
    // A camp's neutral guards (`jungle.ts`) never burn out.
    if (unit.kind === "sentry" && unit.owner !== NEUTRAL)
      if (world.step % SENTRY_DECAY === 0) unit.hp--;
  }
  bury(world, -1);
}

/**
 * The percent of a hit's damage a hero or unit of `team` takes: IRON HIDE takes off a living teammate's best cover
 * (a hero's own hide, or any within its radius for a vehicle), and SPOTTER adds a living enemy's best within its
 * radius. `spotOnly` gives just the SPOTTER part (0 when no enemy spots it), for the view.
 */
export function hideOf(
  world: World,
  victim: Hero | Unit,
  team: number,
  spotOnly = false,
): number {
  let hide = 0,
    spot = 0;
  const vehicle = !("seat" in victim) && !UNITS[victim.kind].robot;
  for (const hero of world.heroes) {
    if (!alive(hero)) continue;
    const friend = teamOf(hero.seat) === team;
    const self = "seat" in victim && victim.seat === hero.seat;
    const level = levelOf(hero.xp);
    for (const each of kitOf(hero)) {
      if (!each.passive || level < each.unlock) continue;
      const { power } = scaled(each, level);
      const inside = within(victim, hero, each.radius);
      if (each.effect === "ironHide" && friend && (self || (vehicle && inside)))
        hide = power > hide ? power : hide;
      if (each.effect === "spotter" && !friend && inside)
        spot = power > spot ? power : spot;
    }
  }
  return spotOnly ? spot : 100 - hide + spot;
}

type Target =
  | { of: "unit"; at: Unit }
  | { of: "hero"; at: Hero }
  | { of: "building"; at: Building; x: number; y: number };

/** Where a target stands, copied. */
function spotOf(target: Target): Spot {
  const { x, y } = target.of === "building" ? target : target.at;
  return { x, y };
}

/** A chosen target: its `MARKS` index and id (a unit's id, a hero's seat, a building's site id). */
export interface Chosen {
  of: number;
  id: number;
}

const idOf = (target: Target): number =>
  target.of === "unit"
    ? target.at.id
    : target.of === "hero"
      ? target.at.seat
      : target.at.id;

/**
 * A `unit` spell's target among `candidates` (units, heroes, buildings, each in id order): the `chosen` one when
 * given, if it is among them within `range` (plus `AIM_SLACK`) of the hero; else the one nearest the aim within
 * `range` of the hero and `radius` of the aim, the first listed winning a tie.
 */
function choose(
  hero: Hero,
  aim: Spot,
  spell: Spell,
  candidates: readonly Target[],
  chosen?: Chosen,
): Target | undefined {
  if (chosen !== undefined) {
    const target = candidates.find(
      (each) => each.of === MARKS[chosen.of] && idOf(each) === chosen.id,
    );
    if (target === undefined) return;
    const at = target.of === "building" ? target : target.at;
    return within(at, hero, spell.range + AIM_SLACK) ? target : undefined;
  }
  let best: Target | undefined,
    bestD = 0;
  for (const each of candidates) {
    const { x, y } = each.of === "building" ? each : each.at;
    if (!within({ x, y }, hero, spell.range)) continue;
    if (!within({ x, y }, aim, spell.radius)) continue;
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
  chosen?: Chosen,
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
  // A point spell aimed beyond its reach is refused, so it lands where the aiming circle said.
  const reach = spell.range + AIM_SLACK;
  if (spell.targeting === "point" && !within(aim, hero, reach)) return false;
  const pick = (candidates: readonly Target[]) =>
    choose(hero, aim, spell, candidates, chosen);
  let owned = 0;
  // Lane waves (`waves.ts`) have their own cap, so they never block a drop.
  for (const unit of world.units)
    if (unit.owner === seat && unit.lane < 0) owned++;
  // Where the spell lands, for the cast event (presentation only).
  let to: Spot = { x: hero.x, y: hero.y };
  const units = (ours: boolean): Target[] =>
    world.units
      .filter((unit) => (teamOf(unit.owner) === team) === ours)
      .map((at) => ({ of: "unit", at }));
  const enemies = units(false);
  const near = (unit: Unit): boolean => {
    const dx = unit.x - hero.x,
      dy = unit.y - hero.y;
    return dx * dx + dy * dy <= spell.radius * spell.radius;
  };
  if (spell.effect === "snipe") {
    const heroes = world.heroes
      .filter((h) => teamOf(h.seat) !== team && alive(h) && h.cloak === 0)
      .map((at): Target => ({ of: "hero", at }));
    const target = pick([...enemies, ...heroes]);
    if (target === undefined) return false;
    to = spotOf(target);
    if (target.of === "unit") {
      const unit = target.at;
      const hit = UNITS[unit.kind].robot ? damage : div(damage * power, 100);
      unit.hp -= div(hit * hideOf(world, unit, teamOf(unit.owner)), 100);
    } else if (target.of === "hero") {
      const victim = target.at;
      const foe = teamOf(victim.seat);
      const hit = div(damage * hideOf(world, victim, foe), 100);
      victim.quiet = 0;
      hurtBy(victim, seat);
      if (hit < victim.hp) victim.hp -= hit;
      else
        award(
          world,
          seat,
          foe,
          victim.x,
          victim.y,
          fell(world, victim, seat, laneMap(map) ? world.step : 0),
        );
    }
  } else if (spell.effect === "cloak") hero.cloak = duration;
  else if (spell.effect === "stickyMine") {
    if (!openTile(map, tx, ty)) return false;
    const laid = world.mines.filter((each) => each.owner === seat);
    if (laid.length >= MINES_PER_HERO)
      world.mines.splice(world.mines.indexOf(laid[0]!), 1);
    const [x, y] = [aim.x, aim.y];
    world.mines.push({ owner: seat, x, y, life: duration, stuck: -1 });
    to = { x, y };
  } else if (spell.effect === "hijack") {
    // A wave's tank (`jungle.ts`) belongs to its lane, so only a drop or a v2 factory's can be taken.
    const tanks = enemies.filter(
      (each) =>
        each.of === "unit" && each.at.kind === "lightTank" && each.at.lane < 0,
    );
    const target = owned < unitCap(world, seat) && pick(tanks);
    if (!target) return false;
    to = spotOf(target);
    Object.assign(target.at, {
      owner: seat,
      goal: -1,
      stun: 0,
      rally: 0,
      lane: -1,
      wave: 0,
    });
  } else if (spell.effect === "repair") {
    const target = pick(mends(map, world, team, units(true)));
    if (target === undefined) return false;
    to = spotOf(target);
    target.at.hp = least(target.at.hp + power, mostHp(map, target));
  } else if (spell.effect === "fortify") {
    const sector = map.sectorOf[tileOf(hero.y) * map.width + tileOf(hero.x)]!;
    const flag = map.flags[sector];
    const owner = world.sectors[sector] ?? -1;
    if (flag === undefined || owner < 0 || teamOf(owner) !== team) return false;
    const post = { x: centreOf(flag.x), y: centreOf(flag.y) };
    if (!within(post, hero, spell.radius)) return false;
    to = post;
    world.fortified[sector] = most(world.fortified[sector]!, duration);
  } else if (spell.effect === "overclock")
    world.overclock[team] = most(world.overclock[team]!, duration);
  else if (spell.effect === "dash") dash(map, hero, spell.range, tx, ty);
  // `to` stays at DASH's start: the caster's position before it moved.
  else if (spell.effect === "flare") {
    if (!openTile(map, tx, ty)) return false;
    [hero.flare, hero.flareLeft] = [ty * map.width + tx, duration];
    to = aim;
    for (const unit of world.units)
      if (unit.owner === seat && UNITS[unit.kind].robot && unit.lane < 0)
        unit.goal = FLARE;
  } else if (spell.effect === "blitz") hero.blitz = duration;
  else if (spell.effect === "orbitalDrop" || spell.effect === "turretDrop") {
    const kind = spell.effect === "orbitalDrop" ? "lightTank" : "sentry";
    let sentries = 0;
    for (const unit of world.units)
      if (unit.owner === seat && unit.kind === "sentry") sentries++;
    if (owned >= unitCap(world, hero.seat)) return false;
    if (kind === "sentry" && sentries >= SENTRIES_PER_HERO) return false;
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
    to = { x: centreOf(tx), y: centreOf(ty) };
    world.units.push({
      id: world.nextId++,
      kind,
      owner: hero.seat,
      x: centreOf(tx),
      y: centreOf(ty),
      hp: kind === "lightTank" ? DROP_HP : UNITS[kind].hp,
      cooldown: 0,
      goal: -1,
      stun: 0,
      rally: 0,
      lane: -1,
      wave: 0,
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
    toX: to.x,
    toY: to.y,
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

const least = (a: number, b: number): number => (a < b ? a : b);
const most = (a: number, b: number): number => (a > b ? a : b);

/** REPAIR BEAM's candidates: the team's hurt units, living heroes and buildings (a ruined turret, never a ruined fort). */
function mends(
  map: GameMap,
  world: World,
  team: number,
  units: readonly Target[],
): Target[] {
  const heroes = world.heroes
    .filter((h) => teamOf(h.seat) === team && alive(h))
    .map((at): Target => ({ of: "hero", at }));
  const buildings = world.buildings.flatMap((at): Target[] => {
    const site = map.sites[at.id]!;
    const owner = ownerOf(map, world, at);
    if (owner < 0 || teamOf(owner) !== team) return [];
    // A lane's towers and gates (`towers.ts`) stay down once destroyed, like a fort.
    if (at.hp === 0 && (site.kind === "fort" || site.lane >= 0)) return [];
    return [{ of: "building", at, x: centreOf(site.x), y: centreOf(site.y) }];
  });
  return [...units, ...heroes, ...buildings].filter(
    (each) => each.at.hp < mostHp(map, each),
  );
}

/** The most hit points a REPAIR BEAM target can have. */
function mostHp(map: GameMap, target: Target): number {
  if (target.of === "unit") return unitMax(target.at);
  if (target.of === "hero") return maxHp(levelOf(target.at.xp), target.at.kind);
  return siteHp(map.sites[target.at.id]!);
}

/** DASH: eight hops toward the aim, each well under a tile, so a wall stops it instead of being crossed. */
function dash(map: GameMap, hero: Hero, range: number, tx: number, ty: number) {
  let dx = centreOf(tx) - hero.x,
    dy = centreOf(ty) - hero.y;
  if (tx === tileOf(hero.x) && ty === tileOf(hero.y)) {
    const [fx, fy] = DIRS[hero.facing]!;
    [dx, dy] = [fx * range, fy * range];
  }
  const length = isqrt(dx * dx + dy * dy);
  if (length === 0) return;
  const reach = least(length, range);
  const [x0, y0] = [hero.x, hero.y];
  for (let hop = 1; hop <= 8; hop++) {
    const nx = x0 + div(dx * reach * hop, length * 8);
    const ny = y0 + div(dy * reach * hop, length * 8);
    [hero.x, hero.y] = settle(map, hero.x, hero.y, nx, ny);
    if (hero.x !== nx || hero.y !== ny) break;
  }
}
