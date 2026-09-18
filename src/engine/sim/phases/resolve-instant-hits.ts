import type { TickContext } from "../context.js";
import { SHIELD_GRACE_TICKS } from "../../tuning.js";
import { isHazardImmune } from "../riders.js";
import { sortedPlayers } from "../../state.js";
import {
  INSTANT_DEATHS_COMMIT_PER_RIDER,
  commitDeaths,
} from "./commit-deaths.js";

/**
 * Fired Guns take effect in the tick they are fired, after every rider has launched — and so after the sweep.
 * Ordinary fuses run before movement instead (`explodeFuses`), so what they clear is gone before anyone rides into it.
 */
export function resolveInstantHits(ctx: TickContext): void {
  const { state, deaths, gunHits } = ctx;
  if (gunHits.size) {
    for (const player of sortedPlayers(state)) {
      if (!player.alive || isHazardImmune(player, state.tick)) continue;
      const hits = gunHits.get(player.id) ?? [];
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
