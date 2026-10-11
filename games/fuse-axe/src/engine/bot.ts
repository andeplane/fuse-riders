import { ATTACK, DOWN, LEFT, MAGIC, RIGHT, UP } from "./input.js";
import { clamp } from "./math.js";
import { isImp, kickable, wants } from "./imps.js";
import { isOgre, threatLane, threatens } from "./ogre.js";
import { hits, isLancer, lancerLane } from "./lancer.js";
import { lashes } from "./mount.js";
import { next } from "./rng.js";
import { SWINGS, hittable } from "./step.js";
import * as T from "./tuning.js";
import {
  SPAWNS,
  mountOf,
  present,
  type Enemy,
  type Hero,
  type HeroState,
  type Item,
  type World,
} from "./world.js";

/**
 * A bot companion: a hero played by the held bits a player logs, read off the world as a player reads the screen, so
 * it gets no rules of its own. Once per log tick it decides, in order: a charge it holds is let go (casting); with a
 * pot and three enemies about it, or low on health with one about, it taps Magic; a ravager's or a lancer's wind-up
 * aimed at it, or a rider's beast's tail, is answered with a swing that lands first (a blow on a rider breaks off the
 * sweep), or a step out of its lane, as is a lancer's leap coming down on it or an ogre's blow; an enemy (a rider too:
 * the combo's finisher knocks it off) or a sack imp in reach takes a swing, and a swing chains the combo while one stays
 * in reach; a pot nobody nearer wants is picked up when no enemy is close; otherwise it walks to stand beside the
 * nearest foe fewer heroes are on (a lower seat keeps its side; a lancer on guard it closes on from out of its spear's
 * lane), or a sack imp; with none, it follows the party. Every press is let go a tick before the next, and it never
 * presses a direction that would make a double tap unless it means to run, which it does far from where it is going.
 *
 * It keeps nothing between ticks beyond what the hero itself holds (`held`, `tap`, `tapUntil`), so a rollback
 * replays it exactly. `humans` names the heroes players steer, whom it follows; without any it leads the way.
 */

/**
 * Its reflexes: it sees a wind-up `REACT` steps in, plus up to `REACT_SPREAD - 1` more, and misses `MISS` in 256 of
 * them outright, each drawn from the seed for that hero, enemy and wind-up.
 */
export const REACT = 4,
  REACT_SPREAD = 8,
  MISS = 24;
/** It fights this far from an enemy along the road, lined up in depth. */
const STAND = T.px(20);
/** It walks along the road, or in depth, once further than the slack from where it wants to be, and on to the hold. */
const SLACK_X = T.px(6),
  HOLD_X = T.px(2),
  SLACK_Y = T.px(3),
  HOLD_Y = T.px(1);
/** Further than this along the road, it runs; a run stops this near. */
const RUN_FAR = T.px(88),
  RUN_STOP = T.px(16);
/** A hero this near an enemy is on it. */
const CROWD_X = T.px(40),
  CROWD_Y = T.px(12);
/** Enemies this near surround it: `SURROUNDED` of them make it cast. */
const NEAR_X = T.px(80),
  NEAR_Y = T.px(32),
  SURROUNDED = 3;
/** It goes for a pot within this, leaving a fight for it only with no enemy within `POT_SAFE` along the road. */
const POT_FAR = T.px(160),
  POT_SAFE = T.px(48);
/** With no enemy about, a leading bot walks to this far into the screen, and each bot after it a gap behind. */
const LEAD_X = T.px(184),
  GAP = T.px(20),
  BEHIND = T.px(28);

/**
 * A lancer standing, walking or winding up is on guard: a bot further than `WARY_X` from it along the road keeps
 * `WARY_Y` out of its lane, beyond its spear's.
 */
const GUARDS: readonly Enemy["state"][] = ["idle", "walk", "windup"];
const WARY_X = T.px(30),
  WARY_Y = T.px(10);

/** The states a bot decides afresh in; in a swing it chains the combo, and in any other it holds nothing. */
const FREE: readonly HeroState[] = ["idle", "walk", "run"];

/** The bits a bot playing hero `heroId` holds for the next log tick. */
export function botInput(
  world: World,
  heroId: number,
  humans: readonly number[] = [],
): number {
  const hero = world.heroes.find((each) => each.id === heroId);
  if (!hero) return 0;
  const index = SWINGS.indexOf(hero.state);
  if (index >= 0) return combo(world, hero, index);
  if (!FREE.includes(hero.state)) return 0;
  const foes = world.enemies.filter(
      (enemy) => !isImp(enemy) && enemy.hp > 0 && onScreen(world, enemy),
    ),
    imps = world.enemies.filter((enemy) => kickable(world, enemy));
  if (casts(world, hero, foes)) return hero.held & MAGIC ? 0 : MAGIC;
  const danger = foes.find((foe) => menaces(world, hero, foe));
  if (danger)
    return counters(world, hero, danger)
      ? swingAt(hero, danger)
      : dodge(hero, danger);
  const opening = [...foes, ...imps].find(
    (enemy) =>
      hittable(world, enemy) &&
      reaches(hero, enemy, T.COMBO[hero.kind][0]!.reach, true),
  );
  if (opening) return swingAt(hero, opening);
  const foe = pick(world, hero, foes),
    pot = potFor(world, hero);
  if (
    pot &&
    !foes.some(
      (each) =>
        hittable(world, each) &&
        Math.abs(each.x - hero.x) < POT_SAFE &&
        Math.abs(each.y - hero.y) < 2 * CROWD_Y,
    )
  )
    return steer(world, hero, pot.x, pot.y);
  const target = foe ?? nearest(hero, imps);
  if (target) return approach(world, hero, target);
  return follow(world, hero, humans);
}

/** Whether `x` is on screen, at least `margin` in from its edges. */
const inside = (world: World, x: number, margin: number): boolean =>
  x >= world.camX + margin && x <= world.camX + T.VIEW_W * T.SUB - margin;
/** Whether an enemy's centre is on screen. */
const onScreen = (world: World, enemy: Enemy): boolean =>
  inside(world, enemy.x, 0);

const near = (hero: Hero, enemy: Enemy): boolean =>
  Math.abs(hero.x - enemy.x) <= CROWD_X &&
  Math.abs(hero.y - enemy.y) <= CROWD_Y;

/** How far, with depth counting double, as the floor band is shallow. */
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + 2 * Math.abs(a.y - b.y);

const nearest = (hero: Hero, enemies: readonly Enemy[]): Enemy | undefined =>
  enemies.reduce<Enemy | undefined>(
    (best, each) => (!best || gap(each, hero) < gap(best, hero) ? each : best),
    undefined,
  );

/**
 * A blade of `reach` would land on `enemy`: in the hero's lane and in front of it, the way it faces or, if it may
 * `turn`, the way the enemy is, with a margin for the enemy's step during the wind-up.
 */
function reaches(hero: Hero, enemy: Enemy, reach: number, turn = false) {
  const dir =
    turn && enemy.x !== hero.x ? (enemy.x > hero.x ? 1 : -1) : hero.facing;
  const ahead = (enemy.x - hero.x) * dir,
    { half } = T.ENEMY_BODY[enemy.kind];
  return (
    ahead + half >= T.px(2) &&
    ahead - half <= reach - T.px(4) &&
    Math.abs(enemy.y - hero.y) <= T.LANE - T.px(1)
  );
}

/** A swing at `enemy`: Attack, with its direction if the hero faces away; or, Attack still held, letting go. */
function swingAt(hero: Hero, enemy: Enemy): number {
  if (hero.held & ATTACK) return 0;
  const dir = enemy.x === hero.x ? hero.facing : enemy.x > hero.x ? 1 : -1;
  return ATTACK | (dir === hero.facing ? 0 : dir > 0 ? RIGHT : LEFT);
}

/**
 * In the combo: the next press chains the next swing while an enemy stays in its reach. A press during the wind-up
 * is dropped, so it waits for the wind-up's last step; the finisher ends the combo.
 */
function combo(world: World, hero: Hero, index: number): number {
  const combo = T.COMBO[hero.kind];
  if (
    hero.held & ATTACK ||
    index === combo.length - 1 ||
    hero.timer + 1 < combo[index]!.startup
  )
    return 0;
  const reach = combo[index + 1]!.reach;
  return world.enemies.some(
    (enemy) => hittable(world, enemy) && reaches(hero, enemy, reach),
  )
    ? ATTACK
    : 0;
}

/** Magic: a pot held, no spell already playing, and enemies about it, or few about it while low on health. */
function casts(world: World, hero: Hero, foes: readonly Enemy[]): boolean {
  if (hero.pots === 0 || world.spells.length > 0) return false;
  const about = foes.filter(
    (foe) =>
      hittable(world, foe) &&
      Math.abs(foe.x - hero.x) <= NEAR_X &&
      Math.abs(foe.y - hero.y) <= NEAR_Y,
  ).length;
  return (
    about >= SURROUNDED || (about > 0 && hero.hp * 3 <= T.HERO_HP[hero.kind])
  );
}

/** A draw from the seed, under 256, the same for one hero and one enemy's wind-up (`foe`'s timer) begun on one step. */
function chance(
  world: World,
  hero: Hero,
  foe: { readonly id: number; readonly timer: number },
  salt: number,
): number {
  const begun = world.step - foe.timer;
  return (
    next(
      (world.seed ^
        Math.imul(hero.id, 0x9e3779b1) ^
        Math.imul(foe.id, 0x85ebca6b) ^
        Math.imul(begun * 2 + salt, 0xc2b2ae35)) >>>
        0,
    ).value & 255
  );
}

/** The wind-up a foe's blow is in, by its timer: a rider's beast's tail, or its own. */
const windupOf = (world: World, foe: Enemy) => {
  const beast = foe.state === "ride" ? mountOf(world, foe.id) : undefined;
  return { id: foe.id, timer: (beast ?? foe).timer, beast };
};

/**
 * A ravager winding up with the hero in its mace's way, an ogre's blow coming at it (`threatens`), a lancer's thrust
 * wound up or its leap coming down (`hits`), or a rider's beast's tail (`lashes`), once the bot has seen it (and if it
 * does).
 */
function menaces(world: World, hero: Hero, foe: Enemy): boolean {
  const ahead = (hero.x - foe.x) * foe.facing,
    clock = windupOf(world, foe);
  return (
    (clock.beast
      ? lashes(clock.beast, hero, T.px(2))
      : isOgre(foe)
        ? threatens(foe, hero, T.px(2))
        : isLancer(foe)
          ? (foe.state === "windup" || foe.state === "leap") &&
            hits(foe, hero, T.px(2))
          : foe.state === "windup" &&
            ahead + T.HERO_HALF_W >= -T.px(2) &&
            ahead - T.HERO_HALF_W <= T.MACE_REACH + T.px(4) &&
            Math.abs(hero.y - foe.y) <= T.LANE + T.px(2)) &&
    clock.timer >= REACT + (chance(world, hero, clock, 0) % REACT_SPREAD) &&
    chance(world, hero, clock, 1) >= MISS
  );
}

/**
 * A wind-up the hero can beat: in front of it, in reach, and the first swing's blade out before the mace, the spear or
 * the tail (a blow on its rider breaks it off). No swing beats an ogre's: its armour takes the blow; nor a leap, which
 * is stepped out of.
 */
function counters(world: World, hero: Hero, foe: Enemy): boolean {
  const first = T.COMBO[hero.kind][0]!,
    late = hero.held & ATTACK ? T.STEPS_PER_TICK : 0,
    { beast, timer } = windupOf(world, foe);
  return (
    !isOgre(foe) &&
    (beast ? beast.state === "sweep" : foe.state === "windup") &&
    (foe.x > hero.x ? 1 : -1) === hero.facing &&
    reaches(hero, foe, first.reach) &&
    (beast ? T.TAIL_WINDUP : T.fighterOf(foe.kind, foe.tier, false).windup) -
      timer >=
      first.startup + 2 + late
  );
}

/**
 * Out of the lane (an ogre's blow's, `threatLane`; a leaping lancer's about where it comes down; a beast's tail's):
 * away from it in depth, toward the middle of the floor band if level with it, the other way against the band's edge,
 * and then also on along the road out of its reach (but from a leap, whose landing is ahead of it).
 */
function dodge(hero: Hero, foe: Enemy): number {
  const leaping = foe.state === "leap",
    y = isLancer(foe) ? lancerLane(foe) : foe.y,
    lane = foe.state === "ride" ? T.TAIL_LANE : T.LANE,
    room = (isOgre(foe) ? threatLane(foe) : lane) + T.px(4);
  let down =
    hero.y !== y ? hero.y > y : 2 * hero.y < T.FLOOR_TOP + T.FLOOR_BOTTOM;
  if (down && hero.y + room > T.FLOOR_BOTTOM) down = false;
  else if (!down && hero.y - room < T.FLOOR_TOP) down = true;
  const crossing = !leaping && (down ? hero.y < y : hero.y > y);
  return (down ? DOWN : UP) | (crossing ? (foe.facing > 0 ? RIGHT : LEFT) : 0);
}

/**
 * The ravager to fight: the nearest, counting an enemy going for this hero nearer, one off its feet further, and one
 * other heroes are on much further (two, as far as a crowd).
 */
function pick(
  world: World,
  hero: Hero,
  foes: readonly Enemy[],
): Enemy | undefined {
  let best: Enemy | undefined,
    score = Infinity;
  for (const foe of foes) {
    const on = world.heroes.filter(
      (other) => other !== hero && present(other) && near(other, foe),
    ).length;
    const each =
      gap(foe, hero) +
      (on >= 2 ? T.px(320) : on * T.px(48)) +
      (hittable(world, foe) ? 0 : T.px(32)) -
      (foe.target === hero.id ? T.px(24) : 0);
    if (each < score) {
      best = foe;
      score = each;
    }
  }
  return best;
}

/**
 * The pot (or at camp the meat) to pick up: the nearest within `POT_FAR` it has room for that no hero with room for it
 * is nearer (`wants`). One the camera has left at the screen's edge is out of reach (a hero stops `HERO_MARGIN` in and
 * picks up within `PICKUP_X`), and walking at it would hold the bot there, and the camera with it, until it spoils.
 */
function potFor(world: World, hero: Hero): Item | undefined {
  let best: Item | undefined,
    score = POT_FAR;
  for (const item of world.items) {
    const each = gap(item, hero);
    if (
      each < score &&
      wants(hero, item.kind) &&
      inside(world, item.x, T.HERO_MARGIN - T.PICKUP_X) &&
      !world.heroes.some(
        (other) =>
          other !== hero &&
          present(other) &&
          wants(other, item.kind) &&
          gap(item, other) < each,
      )
    ) {
      best = item;
      score = each;
    }
  }
  return best;
}

/**
 * Walks to stand `STAND` from an enemy, lined up in depth: on the side it is on, unless a hero of a lower seat is on
 * that side of it and the other is free, or that side is off the screen. A lancer on guard, whose spear outreaches
 * every blade, it closes on from `WARY_Y` out of its lane, stepping in only within `WARY_X` along the road; one that
 * has just thrust, leapt or been hit it goes straight in at.
 */
function approach(world: World, hero: Hero, enemy: Enemy): number {
  const taken = (side: number) =>
    world.heroes.some(
      (other) =>
        other.id < hero.id &&
        present(other) &&
        near(other, enemy) &&
        (other.x < enemy.x ? -1 : 1) === side,
    );
  const fits = (side: number) =>
    inside(world, enemy.x + side * STAND, T.HERO_MARGIN);
  let side = hero.x < enemy.x ? -1 : 1;
  if (!fits(side) || (taken(side) && fits(-side) && !taken(-side)))
    side = -side;
  const wary =
    isLancer(enemy) &&
    GUARDS.includes(enemy.state) &&
    Math.abs(hero.x - enemy.x) > WARY_X;
  const off = 2 * enemy.y < T.FLOOR_TOP + T.FLOOR_BOTTOM ? WARY_Y : -WARY_Y;
  return steer(world, hero, enemy.x + side * STAND, enemy.y + (wary ? off : 0));
}

/**
 * With no enemy about: behind the frontmost hero a player steers, or with none, ahead into the screen so the camera
 * moves on; bots a gap apart in seat order, each in its seat's row, and never near the screen's edges.
 */
function follow(world: World, hero: Hero, humans: readonly number[]): number {
  const leaders = world.heroes.filter(
    (other) => other !== hero && present(other) && humans.includes(other.id),
  );
  const rank = world.heroes.filter(
    (other) =>
      other.id < hero.id && present(other) && !humans.includes(other.id),
  ).length;
  const x = leaders.length
    ? Math.max(...leaders.map((other) => other.x)) - BEHIND - rank * GAP
    : world.camX + LEAD_X - rank * GAP;
  const edge = T.HERO_MARGIN + T.px(8);
  return steer(
    world,
    hero,
    clamp(x, world.camX + edge, world.camX + T.VIEW_W * T.SUB - edge),
    T.px(SPAWNS[hero.seat]![1]),
  );
}

/**
 * Walks toward (`x`, `y`): along the road beyond the slack and on to the hold, running when far (press, let go,
 * press) and on until near, and in depth likewise. Short of a run, a direction is not pressed again while that would
 * make a double tap.
 */
function steer(world: World, hero: Hero, x: number, y: number): number {
  const dx = x - hero.x,
    dy = y - hero.y,
    side = dx > 0 ? RIGHT : LEFT,
    depth = dy > 0 ? DOWN : UP,
    holding = (hero.held & side) !== 0;
  let bits = 0;
  if (hero.state === "run") {
    if (hero.facing > 0 === dx > 0 && Math.abs(dx) > RUN_STOP) bits |= side;
  } else if (Math.abs(dx) > (holding ? HOLD_X : SLACK_X)) {
    if (Math.abs(dx) > RUN_FAR) bits |= holding ? 0 : side;
    else if (holding || hero.tap !== side || world.step >= hero.tapUntil)
      bits |= side;
  }
  if (Math.abs(dy) > (hero.held & depth ? HOLD_Y : SLACK_Y)) bits |= depth;
  return bits;
}
