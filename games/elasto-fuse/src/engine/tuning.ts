/**
 * The race's own numbers. The bike's physics constants are in `bike.ts`, beside the step that uses them.
 */
/** Physics steps a second and per 50 ms log tick. */
export const STEPS_PER_TICK = 4;
export const STEPS_PER_SECOND = STEPS_PER_TICK * 20;
export const CAPACITY = 5;
/** Steps between a race appearing and its start; shorter for a rider alone. */
export const COUNTDOWN = 3 * STEPS_PER_SECOND;
export const SOLO_COUNTDOWN = STEPS_PER_SECOND;
/** A crashed rider is back on the start after this long (or at once on RESTART). */
export const RESPAWN = Math.round(1.2 * STEPS_PER_SECOND);
/** A race closes after this long whoever is still riding. */
export const RACE_LIMIT = 5 * 60 * STEPS_PER_SECOND;
/** Once somebody is home the rest have this long. */
export const RACE_GRACE = 30 * STEPS_PER_SECOND;

/** How far a rider's own clock may run ahead of the race's: its device's clock is never exactly the room's. */
export const RIDER_AHEAD = 2 * STEPS_PER_SECOND;
/** How long past its close a race waits for the riders' last steps to arrive. */
export const CLOSE_LAG = 3 * STEPS_PER_SECOND;
