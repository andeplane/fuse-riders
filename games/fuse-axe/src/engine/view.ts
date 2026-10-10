import { ENEMY_HP, SUB, type EnemyKind, type HeroKind } from "./tuning.js";
import type { EnemyState, FxKind, HeroState, World } from "./world.js";

/**
 * What the renderer sees of the world: positions in whole pixels (`x` along the road, `y` the depth that is also
 * the feet's screen row, `z` height above the floor), so sprites land on the pixel grid. A figure's screen position
 * is `(x − camX, y − z)` and its shadow sits at `(x − camX, y)`. Each value is floored once on its own, so every
 * sprite shares the same whole-pixel camera offset as the backdrop and none shimmers against it.
 */
export type { EnemyKind, HeroKind } from "./tuning.js";
export type { FxKind } from "./world.js";
/** `attack1` and `attack2` are the slashes, `attack3` the finisher. */
export type HeroAnim = HeroState;
export type EnemyAnim = EnemyState;

export interface HeroView {
  id: number;
  seat: number;
  kind: HeroKind;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
  anim: HeroAnim;
  /** Steps since `anim` began; the renderer divides it into sprite frames. */
  animStep: number;
}

export interface EnemyView {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
  /** `dead` lasts `DEAD_STEPS` for the blink before the enemy is gone; `getup` is invulnerable throughout. */
  anim: EnemyAnim;
  animStep: number;
  hp: number;
  maxHp: number;
  /** In hit-stop from a hit just taken: draw the damage flash. */
  flash: boolean;
}

/** A hit spark at its impact point, `age` steps old (under `FX_LIFE`). */
export interface FxView {
  kind: FxKind;
  x: number;
  y: number;
  z: number;
  age: number;
}

export interface WorldView {
  step: number;
  camX: number;
  heroes: HeroView[];
  enemies: EnemyView[];
  fx: FxView[];
}

const whole = (value: number) => Math.floor(value / SUB);

export function toView(world: World): WorldView {
  return {
    step: world.step,
    camX: whole(world.camX),
    heroes: world.heroes.map((hero) => ({
      id: hero.id,
      seat: hero.seat,
      kind: hero.kind,
      x: whole(hero.x),
      y: whole(hero.y),
      z: whole(hero.z),
      facing: hero.facing,
      anim: hero.state,
      animStep: hero.timer,
    })),
    enemies: world.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      x: whole(enemy.x),
      y: whole(enemy.y),
      z: whole(enemy.z),
      facing: enemy.facing,
      anim: enemy.state,
      animStep: enemy.timer,
      hp: enemy.hp,
      maxHp: ENEMY_HP[enemy.kind],
      flash: world.step <= enemy.stopUntil,
    })),
    fx: world.fx.map((fx) => ({
      kind: fx.kind,
      x: whole(fx.x),
      y: whole(fx.y),
      z: whole(fx.z),
      age: world.step - fx.born,
    })),
  };
}
