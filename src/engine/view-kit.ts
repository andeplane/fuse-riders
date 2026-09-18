/** Read-only presentation access to existing rules and geometry; no simulation is run here. */
import type { toSnapshot } from "./game.js";

export type GunView = ReturnType<typeof toSnapshot> & {
  tick: number;
  round: number;
};
export { edgesOpen, obstacleDistanceSquared } from "./arena-map.js";
export { GUN_HEADSHOT_RADIUS, GUN_HOLE_RADIUS, GUN_RADIUS } from "./gun.js";
export { PORTAL_WALL_HALF_WIDTH } from "./portal.js";
export { wrapDelta } from "./wrap.js";
export { TRAIL_DECAY_PAUSE_TICKS } from "./trail-lifecycle.js";
