import type { TickContext } from "../context.js";
import { advanceTrail } from "../../trail-lifecycle.js";
import { sortedPlayers } from "../../state.js";

/** Live trail past its lifetime is dropped and detached debris erodes, before anything is tested against it. */
export function ageTrails({ state }: TickContext): void {
  for (const player of sortedPlayers(state))
    player.trail = advanceTrail(player.trail, state.tick);
}
