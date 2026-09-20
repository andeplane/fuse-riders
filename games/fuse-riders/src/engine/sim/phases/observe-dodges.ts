import type { TickContext } from "../context.js";
import { RIDER_RADIUS } from "../../tuning.js";
import { hypot2 } from "../../deterministic-math.js";
import { isHazardImmune } from "../../effects.js";
import { sortedPlayers } from "../../state.js";
import { square } from "../../geometry.js";

/**
 * A dodge is having been inside a blast's radius before it went off and being alive outside it now; the owner's own
 * retreat and any immune rider do not count. One per rider per tick, against the first such blast in id order.
 */
export function observeDodges(ctx: TickContext): void {
  const { state, observations } = ctx;
  const blasts = ctx.fuseBlasts;
  if (ctx.origins) {
    for (const player of sortedPlayers(state)) {
      const origin = ctx.origins.get(player.id);
      if (!origin || !player.alive || isHazardImmune(player, state.tick))
        continue;
      for (const blast of blasts) {
        if (
          blast.ownerId === player.id ||
          square(origin.x - blast.circle.x) +
            square(origin.y - blast.circle.y) >
            square(blast.circle.radius)
        )
          continue;
        observations.dodges.push({
          playerId: player.id,
          ownerId: blast.ownerId,
          clearance: Math.round(
            hypot2(player.x - blast.circle.x, player.y - blast.circle.y) -
              blast.circle.radius -
              RIDER_RADIUS,
          ),
        });
        break;
      }
    }
  }
}
