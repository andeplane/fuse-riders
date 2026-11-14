/**
 * The engine data the renderer may read beside the view: the arenas (fixed data, found by the view's `mapId`) and
 * the sizes and timings it draws to. Everything here is in pixels and micro-steps.
 *
 * A solid may run past the field's edge on an axis that wraps (see `maps.ts`): draw it again one field back.
 */
export {
  MAP_IDS,
  MAPS,
  mapOf,
  isCircle,
  type MapId,
  type MapDef,
  type Goal,
  type Rect,
  type Circle,
  type Pt,
} from "./maps.js";
export {
  VIEW_W,
  VIEW_H,
  RIDER_RADIUS,
  BALL_RADIUS,
  BUBBLE_RADIUS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  COUNTDOWN_STEPS,
  ZAP_STEPS,
  ZAP_SPEED,
  GOAL_FREEZE_STEPS,
  SPEED_FULL,
  TICKS_PER_SECOND,
  SLIDE_STEPS,
  TARGET,
} from "./tuning.js";
