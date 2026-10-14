import type { Frame } from "fuse-netcode";
import type { BirdsView } from "../online/game.js";

/** Rendering a recovered turn does not mean the returning device has reclaimed its seat yet. */
export function canPlayTurn(
  frame: Frame<BirdsView> | null,
  memberId: string,
  displayOnly: boolean,
  battlefieldReady: boolean,
): boolean {
  if (!frame || displayOnly || !battlefieldReady) return false;
  const seat = frame.seats.find((candidate) => candidate.id === memberId);
  return (
    !!seat?.connected &&
    !seat.away &&
    !seat.watcher &&
    frame.world?.phase === "aiming" &&
    frame.world.players[frame.world.active]?.id === memberId
  );
}
