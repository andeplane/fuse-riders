/** How the hazard sweep writes down what it finds: a cause per rider, who was behind it, and which shot. */
import type { TickContext } from "./context.js";
import { DODGE_LOOKBACK_TICKS } from "../moments.js";
import {
  type EliminationCause,
  type PlayerId,
  sortedPlayers,
} from "../state.js";

export const CAUSE_PRIORITY: Record<EliminationCause, number> = {
  rider: 0,
  trail: 1,
  wall: 2,
  explosion: 3,
};

export function markCause(
  causes: Map<PlayerId, EliminationCause>,
  causeOwners: Map<PlayerId, Map<EliminationCause, Set<PlayerId>>>,
  playerId: PlayerId,
  cause: EliminationCause,
  ownerId?: PlayerId,
): void {
  const current = causes.get(playerId);
  if (!current || CAUSE_PRIORITY[cause] > CAUSE_PRIORITY[current])
    causes.set(playerId, cause);
  if (ownerId === undefined) return;
  let byCause = causeOwners.get(playerId);
  if (!byCause) causeOwners.set(playerId, (byCause = new Map()));
  let owners = byCause.get(cause);
  if (!owners) byCause.set(cause, (owners = new Set()));
  owners.add(ownerId);
}

/** Remember the shot behind an explosion mark. The lowest bomb id wins, whatever order the sources are visited in. */
export function markShot(
  shotSources: TickContext["shotSources"],
  victimId: PlayerId,
  bombId: number,
  shot?: number,
): void {
  if (shot === undefined) return;
  const known = shotSources.get(victimId);
  if (!known || bombId < known.bombId)
    shotSources.set(victimId, { bombId, shot });
}

/** Where each rider stood DODGE_LOOKBACK_TICKS ago, read from its own trail before this tick's blasts burn that segment away. */
export function captureOrigins(ctx: TickContext): void {
  if (ctx.origins) return;
  const { state } = ctx;
  const origins = (ctx.origins = new Map());
  for (const player of sortedPlayers(state)) {
    const segment = player.trail.find(
      (candidate) =>
        candidate.createdTick === state.tick - DODGE_LOOKBACK_TICKS,
    );
    if (segment) origins.set(player.id, { x: segment.x2, y: segment.y2 });
  }
}
