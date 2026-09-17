import {
  CLOSE_AUTHORITY_REPLACED,
  CLOSE_ROOM_ENDED,
  CLOSE_ROOM_FULL,
  CLOSE_UNAUTHENTICATED,
} from "fuse-network-protocol";
export const ROOM_ENDED_TEXT = "Room ended";
export interface RoomSocketCloseActions {
  stopped: () => boolean;
  stop: () => void;
  revoked: () => void;
  ended: () => void;
  /** The room has no free seat: terminal for this page, which says so and leaves trying again to the player. */
  full: () => void;
  /** `refused`: the service refused the handshake itself (4401), which spends its address's failure budget. */
  retry: (refused: boolean) => void;
  status: (message: string) => void;
  terminated: (message: string) => void;
}
/** Terminal room expiry must never retry a public short code that can later belong to another session. */
export function handleRoomSocketClose(
  code: number,
  actions: RoomSocketCloseActions,
): void {
  if (code === CLOSE_ROOM_ENDED) {
    actions.stop();
    actions.ended();
    actions.terminated(ROOM_ENDED_TEXT);
    return;
  }
  if (code === CLOSE_AUTHORITY_REPLACED) {
    actions.stop();
    actions.revoked();
    return;
  }
  // Retrying cannot free a seat, and every attempt is a room service transaction.
  if (code === CLOSE_ROOM_FULL) {
    if (actions.stopped()) return;
    actions.stop();
    actions.full();
    return;
  }
  if (!actions.stopped()) {
    actions.status("Signalling disconnected · retrying");
    actions.retry(code === CLOSE_UNAUTHENTICATED);
  }
}
