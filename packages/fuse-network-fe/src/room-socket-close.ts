import {
  CLOSE_AUTHORITY_REPLACED,
  CLOSE_ROOM_ENDED,
} from "fuse-network-protocol";
export const ROOM_ENDED_TEXT = "Room ended";
export interface RoomSocketCloseActions {
  stopped: () => boolean;
  stop: () => void;
  revoked: () => void;
  ended: () => void;
  retry: () => void;
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
  if (!actions.stopped()) {
    actions.status("Signalling disconnected · retrying");
    actions.retry();
  }
}
