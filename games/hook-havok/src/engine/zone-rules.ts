/**
 * Zone and hazard rule values (12B). Ticks are 60 Hz engine steps; lengths
 * are world units. Presentation receives the ones it draws through the view.
 */
/**
 * A pad launches at 1240 units/s: 2.5× a normal jump's height at the default
 * 1800 units/s² gravity (416 units against 167 over discrete ticks). It is
 * the one speed allowed past the 1000 units/s cap; gravity decays it as usual.
 */
export const PAD_SPEED = 1240;
/** A lift beam replaces gravity with 3000 units/s² towards a 300 units/s rise. */
export const LIFT_RISE = 300,
  LIFT_ACCEL = 3000;
/** The low-gravity wing keeps 40% of gravity. */
export const LOW_GRAVITY = 0.4;
/** In timed rules the floor rises over a round's last 20 s, warned 3 s ahead. */
export const RISE_TICKS = 1200,
  RISE_WARNING = 180;
/** Each laser gate: an 8 s cycle of a 1 s telegraph, then a 0.5 s live sweep. */
export const LASER_PERIOD = 480,
  LASER_TELEGRAPH = 60,
  LASER_LIVE = 30;
/** Half a live beam's thickness, units. */
export const LASER_HALF_WIDTH = 4;
/** Score gains by a keeper inside the crown zone count this many times. */
export const BONUS = 3;
/** A rival's hook hit is credited for a hazard knockout for 2 s. */
export const PUSH_TICKS = 120;
