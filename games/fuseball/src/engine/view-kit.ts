/**
 * The engine data the renderer may read beside the view: the arenas (fixed data, found by the view's `mapId`, or rolled
 * from its `seed`: `arenaOf(view)`) and
 * the sizes and timings it draws to. Everything here is in pixels and micro-steps.
 *
 * A mover is drawn where `moverPlace(mover, view.clock)` has it: the view's clock is all its state.
 *
 * A solid may run past the field's edge on an axis that wraps (see `maps.ts`): draw it again one field back.
 */
export {
  MAP_IDS,
  MAPS,
  RANDOM,
  TEAM_MAP_IDS,
  TEAM_MAPS,
  isTeamMapId,
  teamSizeOf,
  mapOf,
  arenaOf,
  isCircle,
  moverPlace,
  type Ledge,
  type Mover,
  type MapId,
  type ArenaId,
  type TeamArenaId,
  type MapDef,
  type Goal,
  type Rect,
  type Circle,
  type Pt,
  type Barrier,
  type Bumper,
  type Portal,
} from "./maps.js";
export { several, type Several } from "./world.js";
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
  FIELD_COOL_STEPS,
  GATE_OPEN_STEPS,
  ZAP_SPEED,
  GOAL_FREEZE_STEPS,
  SPEED_FULL,
  TICKS_PER_SECOND,
  SLIDE_STEPS,
  TARGET,
} from "./tuning.js";
