import type { TickContext } from "../context.js";
import { RIDER_RADIUS, SHIELD_GRACE_TICKS, TRAIL_WIDTH } from "../../tuning.js";
import { captureOrigins } from "../marks.js";
import { cutTrail } from "../../trail-lifecycle.js";
import { isHazardImmune } from "../riders.js";
import { segmentIntersectsDisk } from "../../blast-geometry.js";
import { sortedPlayers } from "../../state.js";
import {
  INSTANT_DEATHS_COMMIT_PER_RIDER,
  commitDeaths,
} from "./commit-deaths.js";

/**
 * Pressed Guns and released Target Bombs take effect in the tick they are fired, after every rider has launched — and so
 * after the sweep. A rider that crashed into scenery earlier in this tick died against a board that was still standing
 * when it got there, and a Target Bomb landing afterwards then clears that same rock: chronological within the tick,
 * and the same order in which a pickup collected this tick survives a blast opened by it. Ordinary fuses run before
 * movement instead (`explodeFuses`), so what they clear is gone before anyone rides into it.
 */
export function resolveInstantHits(ctx: TickContext): void {
  const { state, deaths, gunHits, instantBlasts } = ctx;
  if (instantBlasts.length || gunHits.size) {
    captureOrigins(ctx);
    for (const player of sortedPlayers(state)) {
      player.trail = cutTrail(
        player.trail,
        state.tick,
        (segment) =>
          instantBlasts.some((blast) =>
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
      if (!player.alive || isHazardImmune(player, state.tick)) continue;
      const hits = [
        ...instantBlasts.filter((blast) =>
          segmentIntersectsDisk(
            player.x,
            player.y,
            player.x,
            player.y,
            blast.circle,
            RIDER_RADIUS,
          ),
        ),
        ...(gunHits.get(player.id) ?? []),
      ];
      if (!hits.length) continue;
      if (player.shielded) {
        player.shielded = false;
        player.shieldGraceUntilTick = state.tick + SHIELD_GRACE_TICKS;
        continue;
      }
      // The shot is the lowest bomb id among the hits, whether or not that bomb names one: the sweep instead takes
      // the lowest bomb id among the sources that do (`markShot`). Engine-made bombs always name their shot, so the
      // two rules only part on a bomb restored without one. Kept as they were; see the design note.
      const shot = hits.reduce((first, hit) =>
        hit.bombId < first.bombId ? hit : first,
      ).shot;
      deaths.push({
        victim: player,
        cause: "explosion",
        owners: [...new Set(hits.map((hit) => hit.ownerId))],
        ...(shot === undefined ? {} : { shot }),
        x: player.x,
        y: player.y,
      });
      if (INSTANT_DEATHS_COMMIT_PER_RIDER) commitDeaths(ctx);
    }
  }
}
