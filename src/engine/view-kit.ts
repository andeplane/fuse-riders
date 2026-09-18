/** Read-only presentation access to existing rules and geometry; no simulation is run here. */
import type { toSnapshot } from "../shared/game.js";

export type GunView = ReturnType<typeof toSnapshot> & {
  tick: number;
  round: number;
};
export { edgesOpen, obstacleDistanceSquared } from "../shared/arena-map.js";
export {
  GUN_HEADSHOT_RADIUS,
  GUN_HOLE_RADIUS,
  GUN_RADIUS,
} from "../shared/gun.js";
export { PORTAL_WALL_HALF_WIDTH } from "../shared/portal.js";
export { wrapDelta } from "../shared/wrap.js";
export { TRAIL_DECAY_PAUSE_TICKS } from "../shared/trail-lifecycle.js";
