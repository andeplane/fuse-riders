import type { TickContext } from "../context.js";
import { hypot2 } from "../../deterministic-math.js";
import { isInvulnerable } from "../riders.js";
import { recordSurvivalTick } from "../../match-stats.js";

/**
 * A rider stopped by a trail, another rider or scenery goes no further than the point of contact. The distance every
 * rider actually covered this tick — up to a gate, for one that crossed — is what the survival statistics count.
 */
export function stopAtContact(ctx: TickContext): void {
  const {
    state,
    movements,
    bounced,
    causes,
    transits,
    trailContactTimes,
    riderContactTimes,
    obstacleContactTimes,
  } = ctx;
  for (const movement of movements.values()) {
    const cause = causes.get(movement.player.id);
    const contactTime =
      cause === "trail"
        ? trailContactTimes.get(movement.player.id)
        : cause === "rider"
          ? riderContactTimes.get(movement.player.id)
          : cause === "wall"
            ? obstacleContactTimes.get(movement.player.id)
            : undefined;
    if (contactTime !== undefined) {
      movement.x = movement.oldX + (movement.x - movement.oldX) * contactTime;
      movement.y = movement.oldY + (movement.y - movement.oldY) * contactTime;
    }
    const travelledTo =
      transits.get(movement.player.id)?.entryPoint ?? movement;
    recordSurvivalTick(
      state.matchStats,
      movement.player.id,
      hypot2(travelledTo.x - movement.oldX, travelledTo.y - movement.oldY),
      isInvulnerable(movement.player, state.tick),
      bounced.has(movement.player.id),
    );
  }
}
