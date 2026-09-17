import type { TickContext } from "../context.js";
import { SHIELD_GRACE_TICKS } from "../../tuning.js";
import { reflectAtBoundary, reflectAtObstacle } from "../riders.js";

/**
 * An orbit shield takes the hit for a marked rider: the shield is spent, a few ticks of grace begin, the rider is turned
 * back from the scenery or wall it reached, and every mark against it this tick is forgotten.
 */
export function resolveDefences(ctx: TickContext): void {
  const {
    state,
    movements,
    bounced,
    causes,
    causeOwners,
    shotSources,
    sceneryReached,
    obstaclesReached,
  } = ctx;
  for (const movement of movements.values()) {
    if (!causes.has(movement.player.id) || !movement.player.shielded) continue;
    movement.player.shielded = false;
    movement.player.shieldGraceUntilTick = state.tick + SHIELD_GRACE_TICKS;
    // Whatever the winning cause was, a rider that reached scenery this tick is standing against it: an absorbed
    // blast must not leave it inside the rock, riding out its grace ticks in there.
    const obstacleTime = sceneryReached.get(movement.player.id);
    const obstacleHit = obstaclesReached.get(movement.player.id);
    if (
      obstacleTime !== undefined &&
      obstacleHit &&
      reflectAtObstacle(obstacleHit, movement, obstacleTime)
    )
      bounced.add(movement.player.id);
    if (reflectAtBoundary(state, movement)) bounced.add(movement.player.id);
    causes.delete(movement.player.id);
    causeOwners.delete(movement.player.id);
    // Together with the cause, or an absorbed hit would still be holding a shot for any later mark to credit.
    shotSources.delete(movement.player.id);
  }
}
