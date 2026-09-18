import type { TickContext } from "../context.js";
import { TRAIL_WIDTH } from "../../tuning.js";
import { captureOrigins } from "../marks.js";
import { cutTrail } from "../../trail-lifecycle.js";
import { segmentIntersectsDisk } from "../../blast-geometry.js";
import { sortedPlayers } from "../../state.js";

/**
 * The fuse blasts burn away every trail segment they touch, before the riders' steps are tested against the trails.
 * Where each rider stood a moment ago is noted first, from the trail about to burn: that is what a dodge is measured from.
 */
export function burnTrails(ctx: TickContext): void {
  const { state } = ctx;
  const newBlasts = ctx.fuseBlasts;
  if (newBlasts.length > 0) {
    captureOrigins(ctx);
    for (const player of sortedPlayers(state)) {
      player.trail = cutTrail(
        player.trail,
        state.tick,
        (segment) =>
          newBlasts.some((blast) =>
            segmentIntersectsDisk(
              segment.x1,
              segment.y1,
              segment.x2,
              segment.y2,
              blast.circle,
              TRAIL_WIDTH / 2,
            ),
          )
            ? []
            : [segment],
        () => state.nextTrailPieceId++,
      );
    }
  }
}
