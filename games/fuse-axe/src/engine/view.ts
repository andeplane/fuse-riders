import { STAGE_1 } from "./stages.js";
import {
  SUB,
  enemyMaxHp,
  type EnemyKind,
  type HeroKind,
  type Tier,
} from "./tuning.js";
import {
  showsGo,
  stageCleared,
  type EnemyState,
  type FxKind,
  type HeroState,
  type World,
} from "./world.js";

/**
 * What the renderer sees of the world: positions in whole pixels (`x` along the road, `y` the depth that is also
 * the feet's screen row, `z` height above the floor), so sprites land on the pixel grid. A figure's screen position
 * is `(x − camX, y − z)` and its shadow sits at `(x − camX, y)`. Each value is floored once on its own, so every
 * sprite shares the same whole-pixel camera offset as the backdrop and none shimmers against it.
 */
export type { EnemyKind, HeroKind, Tier } from "./tuning.js";
export type { FxKind } from "./world.js";
/** `attack1` and `attack2` are the slashes, `attack3` the finisher. */
export type HeroAnim = HeroState;
/** `enter` is a wave's enemy walking in from the screen's edge (or back in to a locked screen): walk frames. */
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
  /** The palette: 0 ash, 1 rust, 2 violet. */
  tier: Tier;
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
  /** The wave begun latest, from 1 (0 before the first), of `waves` in the stage. */
  wave: number;
  waves: number;
  /** A wave is being fought and the screen holds still until it is cleared. */
  locked: boolean;
  /** Flash "GO →": a wave was just cleared and the road ahead is open. */
  go: boolean;
  /** The stage's last wave is cleared. */
  cleared: boolean;
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
      tier: enemy.tier,
      x: whole(enemy.x),
      y: whole(enemy.y),
      z: whole(enemy.z),
      facing: enemy.facing,
      anim: enemy.state,
      animStep: enemy.timer,
      hp: enemy.hp,
      maxHp: enemyMaxHp(enemy.kind, enemy.tier, world.heroes.length),
      flash: world.step <= enemy.stopUntil,
    })),
    fx: world.fx.map((fx) => ({
      kind: fx.kind,
      x: whole(fx.x),
      y: whole(fx.y),
      z: whole(fx.z),
      age: world.step - fx.born,
    })),
    wave: world.wave,
    waves: STAGE_1.waves.length,
    locked: world.locked,
    go: showsGo(world),
    cleared: stageCleared(world),
  };
}
