import type { Frame } from "fuse-netcode";
import type { BirdsView } from "../online/game.js";
import type { Session } from "../online/runtime.js";

/** Rendering a recovered turn does not mean the returning device has reclaimed its seat yet. */
export function canPlayTurn(
  frame: Frame<BirdsView> | null,
  memberId: string,
  displayOnly: boolean,
  battlefieldReady: boolean,
  session: Pick<Session, "admitted">,
): boolean {
  if (!frame || displayOnly || !battlefieldReady || !session.admitted)
    return false;
  return (
    frame.world?.phase === "aiming" &&
    frame.world.players[frame.world.active]?.id === memberId
  );
}
