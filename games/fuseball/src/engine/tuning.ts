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
/** Micro-steps in one 50 ms log tick, and in one while the ball is in a cloud (half speed). */
export const STEPS_PER_TICK = 6,
  CLOUD_STEPS_PER_TICK = 3;

export const CAPACITY = 2;
/** Points that win the match. */
export const TARGET = 3;
export const COUNTDOWN_STEPS = 3 * STEPS_PER_SECOND,
  ZAP_STEPS = 3 * STEPS_PER_SECOND;

export const RIDER_R = px(9),
  BALL_R = px(8),
  BUBBLE_R = px(14);

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

/** Cosmetic counters wrap here, so they stay small integers for ever. */
export const COUNTER = 0x10000;
/** The last step a world may reach: 207 days of play. */
export const MAX_STEP = 0x7fff_ffff;
