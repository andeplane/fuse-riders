import { CAMP } from "./stages.js";
import { CAMP_STEPS } from "./tuning.js";
import type { World } from "./world.js";

/**
 * Camp between stages, after Golden Axe's: a short night scene by a fire. A camp's world (`createWorld` with `camp`)
 * plays the `CAMP` plan: one screen whose camera stands still, no wave, and sack imps sneaking in from the edges by
 * the clock (`ImpCue.step`) to scurry through it. Kicked, a camp imp spills meat and pots in turn (`kick`); meat gives
 * back hit points, no more than the hero's whole health (`advanceItems`). Nothing at camp fights back, so no hero is
 * hurt there, and no magic is cast (`step.ts`). The heroes carry their lives, pots and health into camp and on from it
 * (`carryOf`); the room runs it after a stage's tally and before the next stage (design.md, "Stage flow").
 */

/**
 * Camp is over: `CAMP_STEPS` have passed, or every imp has come and gone and nothing is left lying on the floor. A
 * stage's world is never a camp, so it never is.
 */
export const campOver = (world: World): boolean =>
  world.camp &&
  (world.step >= CAMP_STEPS ||
    (world.impsSent === CAMP.imps.length &&
      world.enemies.length === 0 &&
      world.items.length === 0));

/** Steps left on camp's clock: 0 once it is over, and for a stage's world. */
export const campLeft = (world: World): number =>
  world.camp && !campOver(world) ? CAMP_STEPS - world.step : 0;
