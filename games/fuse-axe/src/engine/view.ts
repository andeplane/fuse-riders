import { SUB, type HeroKind } from "./tuning.js";
import type { HeroState, World } from "./world.js";

/**
 * What the renderer sees of the world: positions in whole pixels (`x` along the road, `y` the depth that is also
 * the feet's screen row, `z` height above the floor), so sprites land on the pixel grid. A hero's screen position
 * is `(x − camX, y − z)` and its shadow sits at `(x − camX, y)`. Each value is floored once on its own, so every
 * sprite shares the same whole-pixel camera offset as the backdrop and none shimmers against it.
 */
export type { HeroKind } from "./tuning.js";
export type HeroAnim = HeroState;

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

export interface WorldView {
  step: number;
  camX: number;
  heroes: HeroView[];
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
  };
}
