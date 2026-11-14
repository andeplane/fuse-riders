/**
 * The engine data the renderer may read beside the view: the court's fixed geometry, in screen pixels (y down), and
 * the timings it draws to. What is drawn where the rules collide comes from here, so what you see is what plays.
 */
import * as T from "./tuning.js";

export const COURT_W = T.COURT_W,
  COURT_H = T.COURT_H;
/** The sand's top, screen y. */
export const SAND_Y = T.COURT_H - T.BLOB_FLOOR / T.HU;
export const NET_X = T.NET_X;
/** The net's rounded top, screen px, and the radius it collides with. */
export const NET_TOP_Y = T.COURT_H - T.NET_TOP_Y / T.BU;
export const NET_CAP_RADIUS = T.NET_HIT / T.BU - T.BALL_RADIUS;
/** Half the pole's width, px: the band the pole turns the ball back in. */
export const POLE_HALF = T.NET_X - (T.POLE_PUT_LEFT / T.BU + T.BALL_RADIUS);
export const BALL_RADIUS = T.BALL_RADIUS;
/** The blob's circles: centres above the feet by squash frame, and their radii (contact distance less the ball's). */
export const HEAD_UP = T.HEAD_UP,
  BODY_UP = T.BODY_UP;
export const HEAD_RADIUS = T.HEAD_HIT / T.BU - T.BALL_RADIUS,
  BODY_RADIUS = T.BODY_HIT / T.BU - T.BALL_RADIUS;
export const SQUASH_FRAMES = T.SQUASH_FRAMES;
export const STEPS_PER_SECOND = T.STEPS_PER_SECOND,
  STEPS_PER_TICK = T.STEPS_PER_TICK,
  SERVE_TIMEOUT = T.SERVE_TIMEOUT,
  DEAD_STEPS = T.DEAD_STEPS,
  MAX_TOUCHES = T.MAX_TOUCHES;
export { serveSeconds } from "./view.js";
