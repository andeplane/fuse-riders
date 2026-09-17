import type { ViewPlayer, WorldView } from "../engine/view.js";

export const RELOAD_RING_RADIUS = 17;

/** Snapshot time keeps reload feedback in sync through pauses, reconnects and rollback. */
export function reloadRemaining(
  player: ViewPlayer,
  snapshot: WorldView,
): number {
  if (!player.alive || snapshot.phase !== "playing") return 0;
  const tick =
    player.presentationTick ?? snapshot.presentationTick ?? snapshot.tick;
  return Math.max(
    0,
    Math.min(1, (player.bombReadyAtTick - tick) / player.reloadDurationTicks),
  );
}
