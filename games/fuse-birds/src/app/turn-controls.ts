import type { Frame } from "fuse-netcode";
import type { BirdsView } from "../online/game.js";
import type { Session } from "../online/runtime.js";

/**
 * Rendering a recovered turn does not mean the returning device has reclaimed its seat yet, and a world that lags the
 * shared clock can still show a turn the log has already timed out.
 */
export function canPlayTurn(
  frame: Frame<BirdsView> | null,
  memberId: string,
  displayOnly: boolean,
  battlefieldReady: boolean,
  session: Pick<Session, "admitted" | "turnTimeLeft">,
): boolean {
  if (
    !frame ||
    displayOnly ||
    !battlefieldReady ||
    !session.admitted ||
    session.turnTimeLeft === 0
  )
    return false;
  return (
    frame.world?.phase === "aiming" &&
    frame.world.players[frame.world.active]?.id === memberId
  );
}
