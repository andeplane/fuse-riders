import type { TickContext } from "../context.js";
import { pickupPacing } from "../../power-progression.js";
import { sortedPlayers } from "../../state.js";

/** The countdown ends on its deadline and play begins on that same tick. Also fixes this tick's pickup pacing. */
export function startPlay(ctx: TickContext): void {
  const { state } = ctx;
  ctx.pickupSchedule = pickupPacing(
    sortedPlayers(state).filter((player) => player.alive).length,
  );
  if (
    state.phase === "countdown" &&
    state.phaseEndsAtTick !== undefined &&
    state.tick >= state.phaseEndsAtTick
  ) {
    state.phase = "playing";
    state.phaseEndsAtTick = undefined;
    state.roundStartedTick = state.tick;
    state.nextPickupSpawnTick = state.tick + ctx.pickupSchedule.interval;
  }
}
