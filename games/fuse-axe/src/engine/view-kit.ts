import {
  CAMERA_END,
  COMBO,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  STAGE_LENGTH,
  SUB,
  type HeroKind,
} from "./tuning.js";

/** The engine constants the renderer may read, in whole pixels where they are distances. */
export {
  VIEW_W,
  VIEW_H,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CAPACITY,
  HERO_KINDS,
  ENEMY_KINDS,
  ENEMY_HP,
  LAND_STEPS,
  HURT_STEPS,
  DOWN_STEPS,
  GETUP_STEPS,
  DEAD_STEPS,
  FX_LIFE,
} from "./tuning.js";
export { ENEMY_STATES, FX_KINDS, HERO_STATES } from "./world.js";

/** The floor band's top and bottom screen rows. */
export const FLOOR_TOP_PX = FLOOR_TOP / SUB;
export const FLOOR_BOTTOM_PX = FLOOR_BOTTOM / SUB;
/** Stage 1's length and the furthest the camera's left edge goes. */
export const STAGE_LENGTH_PX = STAGE_LENGTH / SUB;
export const CAMERA_END_PX = CAMERA_END / SUB;

export interface SwingSteps {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
}
const steps = (kind: HeroKind): readonly SwingSteps[] =>
  COMBO[kind].map(({ startup, active, recovery }) => ({
    startup,
    active,
    recovery,
  }));
/** Each hero's three swings (`attack1`–`attack3`) as steps of wind-up, blade out and recovery, to time the frames. */
export const SWING_STEPS: Readonly<Record<HeroKind, readonly SwingSteps[]>> = {
  brakka: steps("brakka"),
  rhea: steps("rhea"),
  gorm: steps("gorm"),
};
