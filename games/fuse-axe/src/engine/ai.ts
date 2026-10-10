import { clamp } from "./math.js";
import { roll } from "./rng.js";
import * as T from "./tuning.js";
import {
  distance,
  face,
  nearestHero,
  present,
  setState,
  spark,
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
 * knockdown, lying, getting up, a defeat and a walk-in leave it to the rules in `step.ts`. Its walk is no faster
 * than its tier's and keeps to the screen, and its mace lands only on heroes.
 */
const THINKS: readonly EnemyState[] = [
  "idle",
  "walk",
  "windup",
  "attack",
  "recover",
];
export const thinks = (enemy: Enemy): boolean => THINKS.includes(enemy.state);

/** Stands an enemy idle until it next decides: its tier's pause and a random part. */
export function rest(world: World, enemy: Enemy): void {
  const fighter = T.RAVAGER[enemy.tier];
  setState(enemy, "idle");
  enemy.thinkAt = world.step + fighter.think + roll(world, fighter.jitter);
}

/** One step of an enemy that thinks (`thinks`). */
export function act(world: World, enemy: Enemy): void {
  const fighter = T.RAVAGER[enemy.tier],
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
    if (enemy.timer === T.FEINT_AT && roll(world, 256) < fighter.feint) {
      enemy.target = 0;
      walkTo(world, enemy, enemy.x - enemy.facing * T.BACKSTEP, enemy.y);
    } else if (enemy.timer >= fighter.windup) {
      setState(enemy, "attack");
      mace(world, enemy, fighter.damage);
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

/** Goes for the hero it is on, or the nearest with a place free; with none free it hovers near the nearest hero. */
function decide(world: World, enemy: Enemy): void {
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
    stride(world, enemy);
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
function walkTo(world: World, enemy: Enemy, x: number, y: number): void {
  enemy.goal = clamp(
    x,
    Math.max(world.camX + T.ENEMY_HALF_W, 0),
    Math.min(world.camX + T.VIEW_W * T.SUB - T.ENEMY_HALF_W, T.STAGE_LENGTH),
  );
  enemy.goalY = clamp(y, T.FLOOR_TOP, T.FLOOR_BOTTOM);
  setState(enemy, "walk");
}

/**
 * A walking step. One going for a hero heads for its side of it, `ENGAGE_X` away and in its lane, and winds up once
 * lined up with the hero on its feet (lying, it waits); one hovering or backing off faces the nearest hero and stands
 * when it arrives.
 */
function stride(world: World, enemy: Enemy): void {
  const hero = world.heroes.find((each) => each.id === enemy.target);
  if (hero) {
    // Enemies going for the hero or close by claim their sides in id order: it takes the side fewer of the earlier
    // ones are on, its own on a tie, so a crowd surrounds the hero.
    const own = enemy.x < hero.x ? -1 : 1;
    let crowded = 0;
    for (const other of world.enemies)
      if (
        other.id < enemy.id &&
        other.state !== "dead" &&
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
      hero.x + side * T.ENGAGE_X,
      hero.y + (side === own ? 0 : dodge),
    );
    face(enemy, hero.x);
    if (side === own && linedUp(enemy, hero)) {
      if (FLOORED.includes(hero.state)) rest(world, enemy);
      else setState(enemy, "windup");
      return;
    }
  } else {
    const nearest = nearestHero(world, enemy);
    if (nearest) face(enemy, nearest.x);
  }
  const { walk } = T.RAVAGER[enemy.tier];
  enemy.x += clamp(enemy.goal - enemy.x, -walk.x, walk.x);
  enemy.y += clamp(enemy.goalY - enemy.y, -walk.y, walk.y);
  if (!hero && enemy.x === enemy.goal && enemy.y === enemy.goalY)
    rest(world, enemy);
}

/** A hero with a blow out, or coming: swinging or dashing. */
const BLOWS: readonly HeroState[] = ["attack1", "attack2", "attack3", "dash"];
/** A hero knocked off its feet, whom no attacker winds up at. */
const FLOORED: readonly HeroState[] = ["knockdown", "down", "getup"];
/** The states a mace lands in: on its feet or in the air, running, swinging, dashing or reeling. */
const STRUCK: readonly HeroState[] = [
  "idle",
  "walk",
  "run",
  "jump",
  "land",
  ...BLOWS,
  "hurt",
];

/** The mace lands on every hero it reaches in front of the enemy, in the depth lane and below its sweep. */
function mace(world: World, enemy: Enemy, damage: number): void {
  for (const hero of world.heroes) {
    const ahead = (hero.x - enemy.x) * enemy.facing;
    if (
      STRUCK.includes(hero.state) &&
      world.step > hero.invulnUntil &&
      ahead + T.HERO_HALF_W >= 0 &&
      ahead - T.HERO_HALF_W <= T.MACE_REACH &&
      Math.abs(hero.y - enemy.y) <= T.LANE &&
      hero.z < T.MACE_HEIGHT
    )
      wound(world, enemy, hero, damage);
  }
}

/**
 * A hero hit: the damage, then hitstun and a nudge away, which breaks off a swing; or a knockdown up and away when
 * the hit catches it in the air, leaves it with a quarter of its hit points or fewer, or is the `JUGGLE_HITS`th in a
 * row. Attacker and hero both hold still for the hit-stop.
 */
function wound(world: World, enemy: Enemy, hero: Hero, damage: number): void {
  hero.hp -= Math.min(damage, hero.hp);
  if (world.step > hero.staggerUntil) hero.stagger = 0;
  hero.stagger++;
  hero.staggerUntil = world.step + T.JUGGLE_WINDOW;
  const knocked =
    hero.z > 0 ||
    hero.stagger >= T.JUGGLE_HITS ||
    hero.hp * T.LOW_HP_SHARE <= T.HERO_HP[hero.kind];
  if (knocked) hero.stagger = 0;
  const until = world.step + (knocked ? T.HEAVY_HITSTOP : T.HITSTOP);
  hero.stopUntil = Math.max(hero.stopUntil, until);
  enemy.stopUntil = until;
  hero.facing = enemy.facing > 0 ? -1 : 1;
  hero.state = knocked ? "knockdown" : "hurt";
  hero.timer = hero.vy = 0;
  hero.vx = enemy.facing * (knocked ? T.KNOCK_VX : T.HURT_PUSH);
  hero.vz = knocked ? T.KNOCK_VZ : 0;
  spark(
    world,
    hero.hp === 0 ? "ko" : knocked ? "heavy" : "hit",
    hero.x - enemy.facing * T.HERO_HALF_W,
    hero.y,
    hero.z + T.SPARK_HEIGHT,
  );
}
