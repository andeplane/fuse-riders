import type { TickContext } from "../context.js";
import {
  INITIAL_BOUNDARY_INSET,
  OVERTIME_INSET_PER_TICK,
  OVERTIME_START_TICK,
  RIDER_RADIUS,
} from "../../tuning.js";
import { type PortalPair, fitPortalPair } from "../../portal.js";
import { clipTrailSegment } from "../../trail-clipping.js";
import { cutTrail } from "../../trail-lifecycle.js";
import {
  edgesOpen,
  initialBoundaryInset,
  obstacleInsideBounds,
  obstacleIsPermanent,
} from "../../arena-map.js";
import { portalBounds } from "../field.js";
import { sortedPlayers } from "../../state.js";

/**
 * The walls as they stand this tick — overtime brings them in — and everything that has to fit inside them: gates are
 * refitted, scenery the walls have reached is rubble, black holes are kept on the board and trails are clipped.
 */
export function fitField(ctx: TickContext): void {
  const { state } = ctx;
  const elapsed = state.tick - (state.roundStartedTick ?? state.tick);
  state.boundaryInset =
    initialBoundaryInset(state.map, INITIAL_BOUNDARY_INSET) +
    Math.max(0, elapsed - OVERTIME_START_TICK) * OVERTIME_INSET_PER_TICK;
  // Decided once per tick: open edges carry riders, shells, bullets, bombs and blasts through to the far side.
  const open = edgesOpen(state);
  const trailBounds = portalBounds(state);
  ctx.elapsed = elapsed;
  ctx.open = open;
  ctx.trailBounds = trailBounds;
  state.portalPairs = state.portalPairs
    .map((pair) => fitPortalPair(pair, trailBounds, RIDER_RADIUS))
    .filter((pair): pair is PortalPair => pair !== undefined);
  // Scenery is not resized the way a gate is: an obstacle the closing walls have reached is rubble. The movers a
  // map is made of run on regardless, through the closing band and across what is left of the field.
  state.obstacles = state.obstacles.filter(
    (obstacle) =>
      obstacleIsPermanent(obstacle) ||
      obstacleInsideBounds(obstacle, trailBounds),
  );
  // Overtime closes the walls around a field that was legally placed: keep its centre inside, or the pull aims out
  // of bounds. Clamped against the inset computed just above, like the portal fit, rather than last tick's.
  for (const field of state.gravityFields) {
    field.x = Math.max(trailBounds.minX, Math.min(trailBounds.maxX, field.x));
    field.y = Math.max(trailBounds.minY, Math.min(trailBounds.maxY, field.y));
  }
  for (const player of sortedPlayers(state)) {
    player.trail = cutTrail(
      player.trail,
      state.tick,
      (segment) => {
        const clipped = clipTrailSegment(segment, trailBounds);
        return clipped ? [clipped] : [];
      },
      () => state.nextTrailPieceId++,
    );
  }
}
