import { SUB, px } from "./math.js";

/**
 * Every number the simulation is tuned by, in sub-units and micro-steps (120 a second). Speeds are sub-units per
 * step and accelerations sub-units per step per step: 4096 sub-units a step is one pixel a step, 120 pixels a second.
 * Changing any of them changes the rules: bump `RULES` and re-record the golden.
 */
export const VIEW_W = 640,
  VIEW_H = 360;
export const WORLD_W = px(VIEW_W),
  WORLD_H = px(VIEW_H);

export const STEPS_PER_SECOND = 120;
/** Micro-steps in one 50 ms log tick at full speed. */
export const STEPS_PER_TICK = 6;
/** Log ticks in a second: the pace of the arena (its slow motion) is set once per log tick. */
export const TICKS_PER_SECOND = 20;

/**
 * Slow motion. The arena's speed is a fraction of full speed in 1/256ths, set once per log tick; a tick runs
 * `speed × 6 / 256` micro-steps, with the remainder carried to the next tick, so any speed plays out exactly.
 *
 * While the ball's centre is in a cloud the speed eases down to between `CLOUD_SPEED_EDGE` (at the cloud's rim) and
 * `CLOUD_SPEED_CORE` (at its centre), `SLOW_EASE_IN` a tick. Once the ball is out, the speed holds for
 * `SLOW_HOLD_TICKS` and then eases back up, `SLOW_EASE_OUT` a tick.
 */
export const SPEED_FULL = 256,
  /** 0.5 of full speed. */
  CLOUD_SPEED_EDGE = 128,
  /** 0.35 of full speed. */
  CLOUD_SPEED_CORE = 90,
  /** Full speed to the rim's in 0.4 s, to the core's in a little over 0.5 s. */
  SLOW_EASE_IN = 16,
  /** Back to full speed in 0.3 to 0.45 s. */
  SLOW_EASE_OUT = 20,
  /** 0.2 s. */
  SLOW_HOLD_TICKS = 4,
  /** The slowest the arena runs: every log tick still runs at least one micro-step. */
  MIN_SPEED = 43;
/**
 * A goal: nothing moves for `GOAL_FREEZE_STEPS` micro-steps, which the clock counts at full speed (1.3 s), then the
 * zap plays at `ZAP_SPEED` (a quarter of full speed) for `ZAP_STEPS` micro-steps, which at that speed is 94 log
 * ticks (4.7 s). `GOAL_STEPS` is every `stepWorld` call from a goal to the next countdown, and `GOAL_TICKS` the log
 * ticks that takes after the one the goal fell in.
 */
export const GOAL_FREEZE_STEPS = 156,
  ZAP_SPEED = 64,
  ZAP_STEPS = 141,
  GOAL_STEPS = GOAL_FREEZE_STEPS + ZAP_STEPS,
  GOAL_TICKS = 26 + 94;

export const CAPACITY = 2;
/** Points that win the match. */
export const TARGET = 3;
export const COUNTDOWN_STEPS = 3 * STEPS_PER_SECOND;

/** Radii in pixels, for whoever draws them, and in sub-units for the rules. */
export const RIDER_RADIUS = 9,
  BALL_RADIUS = 8,
  BUBBLE_RADIUS = 14;
export const RIDER_R = px(RIDER_RADIUS),
  BALL_R = px(BALL_RADIUS),
  BUBBLE_R = px(BUBBLE_RADIUS);

export const GRAVITY_RISE = 92,
  GRAVITY_FALL = 103,
  /** Added while the stick is held down. */
  GRAVITY_DOWN = 62;
export const RUN_ACCEL = 283,
  /** Running stops accelerating here. */
  RUN_SPEED = 7833,
  /** Each step a rider loses 1/`DRAG` of its sideways speed. */
  DRAG = 75,
  /** The same on the ground with the stick let go: a rider skids to a stop. */
  GROUND_DRAG = 12,
  MAX_VX = 14506,
  MAX_RISE = 8704,
  MAX_FALL = 17408;
export const JUMP = 6528,
  QUICK_DROP = 3264;

/** A grounded jump lifts the ball when it is this close: sideways, and up or down. */
export const LIFT_X = px(50),
  LIFT_Y = px(20),
  LIFT_SPEED = 6528,
  /** The ball takes this share of the lifting rider's sideways speed. */
  LIFT_CARRY_NUM = 3,
  LIFT_CARRY_DEN = 4;

export const SLIDE_STEPS = 78,
  SLIDE_START = 14506,
  SLIDE_END = 7833,
  SLIDE_POP = 3800;

export const BALL_GRAVITY = 62,
  BALL_MAX = 15957,
  /** What a solid gives back of the ball's speed into it. */
  BALL_BOUNCE_NUM = 4,
  BALL_BOUNCE_DEN = 5,
  /** Touching a solid costs the ball 1/`BALL_SCRUB` of its speed: a rolling ball comes to rest. */
  BALL_SCRUB = 256,
  /** A rider kicks the ball away at 1 + 1/2 of their closing speed. */
  KICK_NUM = 3,
  KICK_DEN = 2,
  /** A bounce or kick at least this hard is counted for the presentation. */
  BOUNCE_FX = SUB / 2;

/** A bubble halves the ball's speed, then throws it away from its centre at this speed. */
export const BUMP = 8704;

/**
 * A ball still this far inside a rider or bubble once the solids have pushed it back is pinned between the two, and
 * squirts out along the solid at this speed.
 */
export const PIN_SLACK = SUB / 2,
  SQUIRT = 5120;

/**
 * Gadgets. A force field throws the ball back at `FIELD_KICK` at least, and after a strike the next one counts only
 * `FIELD_COOL_STEPS` later (half a second). A gate opens for `GATE_OPEN_STEPS` (three seconds) when the ball
 * strikes it at `GATE_KNOCK` or faster: a dropped or lifted ball does, a rolling one does not.
 */
export const FIELD_KICK = 8704,
  FIELD_COOL_STEPS = 60,
  GATE_KNOCK = 3072,
  GATE_OPEN_STEPS = 360;

/** Cosmetic counters wrap here, so they stay small integers for ever. */
export const COUNTER = 0x10000;
/** The last step a world may reach: 207 days of play. */
export const MAX_STEP = 0x7fff_ffff;
