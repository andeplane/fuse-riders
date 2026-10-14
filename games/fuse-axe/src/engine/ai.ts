import { clamp } from "./math.js";
import { isImp } from "./imps.js";
import { roll } from "./rng.js";
import { planOf } from "./stages.js";
import * as T from "./tuning.js";
import {
  distance,
  face,
  flinch,
  nearestHero,
  present,
  setState,
  spark,
  unseat,
  type Enemy,
  type EnemyState,
  type Hero,
  type HeroState,
  type World,
} from "./world.js";

/**
 * How a ravager fights, and how a hero takes its blows. An idle enemy waits out its tier's pause (or meets a hero
 * who walks up into its lane at once), then picks the nearest hero on the field with a place free among its
 * `ATTACKERS` and walks to stand `ENGAGE_X` from it, lining up in depth as it goes: on its own side, unless more of
 * the enemies around the hero are there or the hero swings its blade or dashes that way, when it walks round to the
 * other.
 * Lined up, it winds up (facing fixed, so a hero who steps out of the lane or away is missed), swings the mace on
 * the attack's first step, then recovers and pauses again. One with no place free hovers at a distance from the
 * nearest hero, a fresh spot each time, and a wind-up is now and then a feint that backs off. Every random choice
 * draws from the world's stream. An enemy only thinks standing, walking or in its own swing: hit-stop, reeling, a
 * knockdown, lying, getting up, a defeat and a walk-in leave it to the rules in `step.ts`, and a spell's freeze
 * (`magic.ts`) holds it as it stands, wind-up and all, thinking nothing until the blow lands. Its walk is no faster
 * than its tier's and keeps to the screen, and its mace lands only on heroes. A lancer (`lancer.ts`) picks its hero
 * the same way (`decide`) and walks the same way to its own reach (`stride`), but thrusts and leaps where this swings.
 */
const THINKS: readonly EnemyState[] = [
  "idle",
  "walk",
  "windup",
  "attack",
  "recover",
  // An ogre's (`ogre.ts`), a lancer's (`lancer.ts`) and Vorhal's (`vorhal.ts`), which they play out themselves.
  "slam",
  "sweep",
  "stagger",
  "thrust",
  "plunge",
  "cut1",
  "cut2",
  "cast",
  "summon",
  "roar",
];
export const thinks = (enemy: Enemy): boolean => THINKS.includes(enemy.state);

/** The fighter an enemy is: its tier's ravager or lancer, or an ogre's mood. */
export const fighter = (enemy: Enemy): T.Fighter =>
  T.fighterOf(enemy.kind, enemy.tier, enemy.enraged);

/** Stands an enemy idle until it next decides: its tier's pause and a random part. */
export function rest(world: World, enemy: Enemy): void {
  const { think, jitter } = fighter(enemy);
  setState(enemy, "idle");
  enemy.thinkAt = world.step + think + roll(world, jitter);
}

/** How far a ravager's mace, or a bonewalker's sword, reaches in front of it. */
export const reachOf = (enemy: Enemy): number =>
  enemy.kind === "bonewalker" ? T.BONE_REACH[enemy.tier] : T.MACE_REACH;

/**
 * One step of a ravager, or a bonewalker (its own fighter and reach), that thinks (`thinks`): an ogre and a lancer
 * have their own (`ogreAct`, `lancerAct`), which share `decide`, `stride` and `rest` with it.
 */
export function act(world: World, enemy: Enemy): void {
  const stats = fighter(enemy),
    target = world.heroes.find((hero) => hero.id === enemy.target);
  if (enemy.target && !(target && present(target))) enemy.target = 0;
  if (enemy.state === "idle") {
    const towards = target ?? nearestHero(world, enemy);
    if (towards) face(enemy, towards.x);
    // A hero who walks up into its lane is met at once; one lying there is waited out, not re-decided every step.
    if (
      world.step >= enemy.thinkAt ||
      (towards && linedUp(enemy, towards) && !FLOORED.includes(towards.state))
    )
      decide(world, enemy);
  } else if (enemy.state === "walk") stride(world, enemy);
  else if (enemy.state === "windup") {
    if (enemy.timer === T.FEINT_AT && roll(world, 256) < stats.feint) {
      enemy.target = 0;
      walkTo(world, enemy, enemy.x - enemy.facing * T.BACKSTEP, enemy.y);
    } else if (enemy.timer >= stats.windup) {
      setState(enemy, "attack");
      mace(world, enemy, stats.damage, reachOf(enemy));
    }
  } else if (enemy.state === "attack") {
    if (enemy.timer >= T.ATTACK_STEPS) setState(enemy, "recover");
  } else if (enemy.timer >= T.RECOVER_STEPS) rest(world, enemy);
}

/** A hero within reach of an attacker's stand-off along the road and in its lane. */
const linedUp = (enemy: Enemy, hero: Hero): boolean =>
  Math.abs(hero.x - enemy.x) <= T.ENGAGE_X + T.ENGAGE_SLACK &&
  Math.abs(hero.y - enemy.y) <= T.AI_LANE;

/** Enemies besides `enemy` going for `hero`. */
const attackers = (world: World, hero: Hero, enemy: Enemy): Enemy[] =>
  world.enemies.filter((other) => other !== enemy && other.target === hero.id);

/**
 * Goes for the hero it is on, or the nearest with a place free among the `ATTACKERS` going for it, whatever their kind,
 * walking with `walk` (a lancer has its own); with none free it hovers near the nearest hero.
 */
export function decide(world: World, enemy: Enemy, walk = stride): void {
  let pick = world.heroes.find((hero) => hero.id === enemy.target);
  for (const hero of pick ? [] : world.heroes)
    if (
      present(hero) &&
      attackers(world, hero, enemy).length < T.ATTACKERS &&
      (!pick || distance(hero, enemy) < distance(pick, enemy))
    )
      pick = hero;
  const nearest = nearestHero(world, enemy);
  if (pick) {
    enemy.target = pick.id;
    setState(enemy, "walk");
    walk(world, enemy);
  } else if (nearest) {
    const side = enemy.x < nearest.x ? -1 : 1;
    walkTo(
      world,
      enemy,
      nearest.x + side * (T.HOVER_X + roll(world, T.HOVER_SPREAD)),
      T.FLOOR_TOP + roll(world, T.FLOOR_BOTTOM - T.FLOOR_TOP),
    );
  } else rest(world, enemy);
}

/** Walks an enemy toward (`x`, `y`), held to the road, the floor band and the screen. */
export function walkTo(world: World, enemy: Enemy, x: number, y: number) {
  const { half } = T.ENEMY_BODY[enemy.kind];
  enemy.goal = clamp(
    x,
    Math.max(world.camX + half, 0),
    Math.min(world.camX + T.VIEW_W * T.SUB - half, planOf(world).length),
  );
  enemy.goalY = clamp(y, T.FLOOR_TOP, T.FLOOR_BOTTOM);
  setState(enemy, "walk");
}

/**
 * A walking step. One going for a hero heads for its side of it, `reach` away (a ravager's `ENGAGE_X`) and in its lane,
 * and winds up once `lined` up with the hero on its feet (lying, it waits); one hovering or backing off faces the
 * nearest hero and stands when it arrives.
 */
export function stride(
  world: World,
  enemy: Enemy,
  reach = T.ENGAGE_X,
  lined = linedUp,
): void {
  const hero = world.heroes.find((each) => each.id === enemy.target);
  if (hero) {
    // Enemies going for the hero or close by claim their sides in id order: it takes the side fewer of the earlier
    // ones are on, its own on a tie, so a crowd surrounds the hero. A sack imp passing by claims nothing.
    const own = enemy.x < hero.x ? -1 : 1;
    let crowded = 0;
    for (const other of world.enemies)
      if (
        other.id < enemy.id &&
        other.state !== "dead" &&
        !isImp(other) &&
        (other.target === hero.id || Math.abs(other.x - hero.x) < T.HOVER_X)
      )
        crowded += (other.x < hero.x ? -1 : 1) === own ? 1 : -1;
    let side = crowded > 0 ? -own : own;
    // A hero swinging its blade or dashing is gone round to its back. Crossing to the far side, it walks round
    // `DODGE` out of the hero's lane, toward the middle of the floor band.
    if (side === hero.facing && BLOWS.includes(hero.state)) side = -side;
    const dodge =
      hero.y * 2 < T.FLOOR_TOP + T.FLOOR_BOTTOM ? T.DODGE : -T.DODGE;
    walkTo(
      world,
      enemy,
      hero.x + side * reach,
      hero.y + (side === own ? 0 : dodge),
    );
    face(enemy, hero.x);
    if (side === own && lined(enemy, hero)) {
      if (FLOORED.includes(hero.state)) rest(world, enemy);
      else setState(enemy, "windup");
      return;
    }
  } else {
    const nearest = nearestHero(world, enemy);
    if (nearest) face(enemy, nearest.x);
  }
  const { walk } = fighter(enemy);
  enemy.x += clamp(enemy.goal - enemy.x, -walk.x, walk.x);
  enemy.y += clamp(enemy.goalY - enemy.y, -walk.y, walk.y);
  if (!hero && enemy.x === enemy.goal && enemy.y === enemy.goalY)
    rest(world, enemy);
}

/** A hero with a blow out, or coming: swinging or dashing. */
const BLOWS: readonly HeroState[] = ["attack1", "attack2", "attack3", "dash"];
/** A hero knocked off its feet, whom no attacker winds up at. */
export const FLOORED: readonly HeroState[] = ["knockdown", "down", "getup"];
/**
 * The states a mace lands in: on its feet or in the air, running, swinging, dashing, stabbing, striking behind,
 * throwing, reeling or charging magic, which the hit breaks off, or riding a beast (`mount.ts`). A hero mid-grab is out
 * of its way: the grab is brief and always ends in the throw. So is one casting a spell (`magic.ts`).
 */
const STRUCK: readonly HeroState[] = [
  "ride",
  "idle",
  "walk",
  "run",
  "jump",
  "land",
  ...BLOWS,
  "hurt",
  "jumpattack",
  "backattack",
  "throw",
  "charge",
];

/** A hero a blow can land on now: in a state one lands in (`STRUCK`) and not invulnerable. */
export const exposed = (world: World, hero: Hero): boolean =>
  STRUCK.includes(hero.state) && world.step > hero.invulnUntil;

/** The mace (or sword) lands on every hero within `reach` in front of the enemy, in the depth lane and below its sweep. */
function mace(world: World, enemy: Enemy, damage: number, reach: number) {
  for (const hero of world.heroes) {
    const ahead = (hero.x - enemy.x) * enemy.facing;
    if (
      exposed(world, hero) &&
      ahead + T.HERO_HALF_W >= 0 &&
      ahead - T.HERO_HALF_W <= reach &&
      Math.abs(hero.y - enemy.y) <= T.LANE &&
      hero.z < T.MACE_HEIGHT
    )
      enemy.stopUntil = wound(world, hero, damage, enemy.facing);
  }
}

/**
 * A hero hit by a blow going the way `dir` points along the road: the damage, then hitstun and a nudge that way, which
 * breaks off a swing; or a knockdown up and away when the blow always knocks down (`knock`), the hit catches it in the
 * air, leaves it with a quarter of its hit points or fewer, or is the `JUGGLE_HITS`th in a row. The hero holds still
 * for the hit-stop, which is returned for the attacker to share. A rider's saddle takes any blow but a knockdown, which
 * throws it off its beast (`unseat`; a hop is in the air, so any blow then): it holds still, and a beast's blow still
 * winding up (a tail, a drake's inhale) is broken off (`flinch`).
 */
export function wound(
  world: World,
  hero: Hero,
  damage: number,
  dir: 1 | -1,
  knock = false,
): number {
  hero.hp -= Math.min(damage, hero.hp);
  if (world.step > hero.staggerUntil) hero.stagger = 0;
  hero.stagger++;
  hero.staggerUntil = world.step + T.JUGGLE_WINDOW;
  const knocked =
    knock ||
    hero.z > 0 ||
    hero.stagger >= T.JUGGLE_HITS ||
    hero.hp * T.LOW_HP_SHARE <= T.HERO_HP[hero.kind];
  if (knocked) hero.stagger = 0;
  const until = world.step + (knocked ? T.HEAVY_HITSTOP : T.HITSTOP);
  hero.stopUntil = Math.max(hero.stopUntil, until);
  if (hero.state === "ride") {
    if (!knocked) {
      flinch(world, hero);
      const z = T.SADDLE + T.SPARK_HEIGHT;
      spark(world, "hit", hero.x - dir * T.HERO_HALF_W, hero.y, z);
      return until;
    }
    unseat(world, hero, dir);
  }
  hero.facing = dir > 0 ? -1 : 1;
  hero.state = knocked ? "knockdown" : "hurt";
  hero.timer = hero.vy = 0;
  hero.vx = dir * (knocked ? T.KNOCK_VX : T.HURT_PUSH);
  hero.vz = knocked ? T.KNOCK_VZ : 0;
  spark(
    world,
    hero.hp === 0 ? "ko" : knocked ? "heavy" : "hit",
    hero.x - dir * T.HERO_HALF_W,
    hero.y,
    hero.z + T.SPARK_HEIGHT,
  );
  return until;
}
