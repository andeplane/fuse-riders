import type { TickContext } from "../context.js";
import { RIDER_RADIUS } from "../../tuning.js";
import { findPortalTransit } from "../../portal.js";
import { isClearOfPortalWalls, isSafePortalPosition } from "../portals.js";
import { portalBounds } from "../field.js";
import { effectUntil } from "../../effects.js";

/**
 * A surviving rider whose step crosses a gate is given a transit to the paired gate, if the exit is safe. Riders are
 * visited in seat order and each sees the transits already granted, so two riders are never sent to the same spot.
 */
export function portalTransit(ctx: TickContext): void {
  const { state, movements, causes, transits } = ctx;
  for (const movement of movements.values()) {
    if (causes.has(movement.player.id)) continue;
    const transit = findPortalTransit({
      pairs: state.portalPairs,
      tick: state.tick,
      from: { x: movement.oldX, y: movement.oldY },
      to: movement,
      cooldownUntilTick: effectUntil(movement.player, "portalCooldown"),
      bounds: portalBounds(state),
      riderRadius: RIDER_RADIUS,
      isSafeExit: (point, radius, pairId) =>
        isSafePortalPosition(
          state,
          point,
          radius,
          movements,
          movement.player.id,
          causes,
          transits,
        ) && isClearOfPortalWalls(state, point, radius, pairId),
    });
    if (transit) transits.set(movement.player.id, transit);
  }
}
