/**
 * The few pure kernels presentation legitimately runs itself, and the only engine module besides `view.ts` that
 * `games/fuse-riders/src/render/` may import (`tests/layer-boundaries.test.ts`). Everything else a screen needs of the rules travels as
 * data in the `WorldView`: if a renderer wants a constant from here, publish the value in the view instead.
 *
 * An entry earns its place by being a function of its arguments, holding no state, that presentation must evaluate at a
 * time or place the simulation never did. Some embed tuning (`bombAimDistance` the launch range, Range levels and charge time,
 * `advanceTrail` the decay per tick): they are the same functions the simulation runs, re-exported, so a screen never
 * keeps a copy in step. No simulation is run here.
 */

// Between two ticks: the local rider is led ahead with the turn-then-move kernel, bent by the holes it is inside of,
// taking its `speed` and `turn` from the view. The simulation and the bots run the same two functions.
export { advanceRiderPose, type MotionControls } from "./rider-motion.js";
export { gravityBend } from "./gravity.js";

// The charge marker is drawn at a fractional charge age on the same aim curve a release samples at whole ticks, and the
// power chip names the reach a Range level gives.
export { bombAimDistance, bombRangeMultiplier } from "./bomb-launch.js";

// A board with open edges: fold a point back onto it, take the short way round, and list where something near an
// edge has to be drawn a second time. Plain arithmetic on a width and a height.
export {
  wrapCoordinate,
  wrapDelta,
  wrapImages,
  type WrapOffset,
} from "./wrap.js";

// Debris is what a blast removed, so a screen has to tell "burnt" from "aged away": it ages the trail it kept from
// the tick before exactly as the simulation would have, and tests what is missing against the blast's disk.
export { advanceTrail } from "./trail-lifecycle.js";
export { segmentIntersectsDisk } from "./blast-geometry.js";

// A gun impact is cosmetic evidence at an endpoint the simulation already resolved: the screen asks whether that
// endpoint touches a piece of scenery, with the same rectangle distance the simulation used.
//
// A piece's artwork is chosen by the same variant lookup the layout placed it with, so the sprite a screen draws can
// never be a different shape from the collider the simulation kills against.
export { obstacleDistanceSquared, obstacleVariant } from "./arena-map.js";
export type { ObstacleVariant } from "./arena-map.js";

// A train's rails are drawn from the same loop its cars are advanced along, and a car's lights face the way the
// rails run where it stands: the one kernel, so the drawing cannot put a train beside its track.
export { trackLength, trackPose } from "./scenery-motion.js";

// The pickup vocabulary as a list: the scene preloads one sprite per type before any view exists.
export { PICKUP_TYPES } from "./pickup-types.js";

// A held Gun sight is drawn between ticks too: the local rider's sight is led with the controls it holds right now,
// on the same per-tick sweep the simulation applies, and a sight is up exactly while `gunAim` is present.
export { isAimingGun, sweepGunAim } from "./gun.js";
