import * as T from "./tuning.js";
import type { Grave } from "./stages.js";
import {
  faceNearest,
  setState,
  spark,
  type Enemy,
  type EnemyState,
  type Hero,
  type World,
} from "./world.js";

/**
 * Bonewalkers (design.md, "Enemies": a skeleton swordsman that claws up out of the ground; the Drowned Crypt's). One
 * fights as a ravager does (`act` in `ai.ts`), with its tier's `BONEWALKER` fighter and its sword's `BONE_REACH`; the
 * violet tier is the armoured knight, toughest and longest in reach. A wave's bonewalker may claw up out of a grave on
 * the locked screen (`rise`): it stands there for `RISE_STEPS` as it climbs out, struck by nothing (no blade, thrown
 * body or spell), then stands and decides.
 *
 * It falls apart once: the first time a fall leaves it with no hit points it lies as a bone pile (`pile`) instead of
 * falling for good, and after `PILE_STEPS` pulls itself together (`reassemble`: no blade lands on it, as on one getting
 * up, but a spell, which lands on a getting-up enemy too, does) with half its full hit points, to fight on. Any blow
 * that lands on the pile (a blade, a jump attack's stab, a beast's blow, a thrown body or a spell) shatters it for
 * good, counting as a knockdown to the hero who struck it; nobody grabs a pile, as it is never dazed. The second fall
 * with no hit points is the last.
 */
export const isBonewalker = (enemy: Enemy): boolean =>
  enemy.kind === "bonewalker";

/** A wave's bonewalker claws up out of `grave`, facing the nearest hero. */
export function rise(world: World, enemy: Enemy, grave: Grave): void {
  enemy.x = enemy.goal = grave.x;
  enemy.y = enemy.goalY = grave.y;
  setState(enemy, "rise");
  faceNearest(world, enemy);
}

/** Where an enemy coming down from a fall lies: down with hit points left, else a bonewalker's pile once, else dead. */
export const fallen = (enemy: Enemy): EnemyState =>
  enemy.hp > 0
    ? "down"
    : isBonewalker(enemy) && !enemy.reassembled
      ? "pile"
      : "dead";

/** The pile's time is up: it pulls itself together, half its full hit points back, for the one time it does. */
export function reassemble(world: World, enemy: Enemy): void {
  const full = T.enemyMaxHp(enemy.kind, enemy.tier, world.heroes.length);
  enemy.hp = Math.max(1, Math.trunc(full / 2));
  enemy.reassembled = true;
  setState(enemy, "reassemble");
}

/** A blow on a bone pile shatters it for good, a knockdown to `hero`'s tally. */
export function shatter(world: World, enemy: Enemy, hero: Hero): void {
  setState(enemy, "dead");
  hero.knockdowns++;
  spark(world, "ko", enemy.x, enemy.y, T.SPARK_HEIGHT / 4);
}
