import type { TickContext } from "../context.js";
import { markCause } from "../marks.js";

/**
 * Scenery kills under `wall`, which outranks `trail` and `rider`. Unlike the boundary, which a rider can only
 * reach at the end of its step, an obstacle can be met anywhere along it — so a rock a rider would have reached
 * later in the tick must not take a kill away from the trail or the rider that actually stopped it first.
 * A rider already dead by explosion still keeps its contact, which is what the shield bounces off.
 */
export function settleSceneryContacts(ctx: TickContext): void {
  const {
    movements,
    causes,
    causeOwners,
    trailContactTimes,
    riderContactTimes,
    obstacleContactTimes,
  } = ctx;
  // What the shield below bounces off: every scenery contact of the tick, whichever cause ends up winning it.
  ctx.sceneryReached = new Map(obstacleContactTimes);
  for (const movement of movements.values()) {
    const contact = obstacleContactTimes.get(movement.player.id);
    if (contact === undefined) continue;
    // No trail or rider contact is no contact at all, not one at the end of the step: a rock met exactly there still counts.
    const reachedFirst = Math.min(
      trailContactTimes.get(movement.player.id) ?? Infinity,
      riderContactTimes.get(movement.player.id) ?? Infinity,
    );
    if (reachedFirst <= contact) {
      obstacleContactTimes.delete(movement.player.id);
      continue;
    }
    markCause(causes, causeOwners, movement.player.id, "wall");
  }
}
