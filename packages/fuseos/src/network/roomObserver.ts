import type { RefObject } from "react";
import { useContext, useEffect } from "react";

import { NetworkDepsContext } from "./networkDeps";
import { RecentRoomsStoreContext } from "./recentRooms";
import { roomCodeInUrl } from "./roomCode";

/** How often a game frame's address is read for a `?room=`; a room appears once per match, so seconds are plenty. */
export const ROOM_POLL_INTERVAL_MS = 2000;

/** The part of a frame the observer reads: same-origin pages expose their location, others throw. */
export type FrameLike = {
  contentWindow: { location: { search: string } } | null;
};

/** The room the page inside `frame` is in, or null when it is in none or its address cannot be read. */
export function readRoomInFrame(
  frame: FrameLike | null | undefined,
): string | null {
  try {
    const search = frame?.contentWindow?.location.search;
    return search === undefined ? null : roomCodeInUrl(search);
  } catch {
    // A cross-origin page (not one of ours) hides its address; nothing to record.
    return null;
  }
}

/**
 * Records the room a game frame joins into the recent-rooms list. Games put `?room=CODE` in their own
 * address when they create or join a room (`history.pushState`/`replaceState` or a navigation), and
 * the frame is same origin, so the OS can read it without the game saying anything.
 *
 * Integration: the game window that owns the `<iframe>` calls this with its ref and the game id,
 * e.g. in `FuseGameWindow`/`IframeGame`: `useRecordRoomFromFrame(frameRef, gameId)`. See docs/fuseos/network.md.
 */
export function useRecordRoomFromFrame(
  frame: RefObject<FrameLike | null>,
  gameId: string,
): void {
  const recentRooms = useContext(RecentRoomsStoreContext);
  const { every, now } = useContext(NetworkDepsContext);
  useEffect(() => {
    let last: string | null = null;
    const check = () => {
      const code = readRoomInFrame(frame.current);
      if (code === null || code === last) return;
      last = code;
      recentRooms.record({ gameId, code }, now());
    };
    check();
    return every(check, ROOM_POLL_INTERVAL_MS);
  }, [frame, gameId, recentRooms, every, now]);
}

/** Records a room the OS itself opened (the Join room dialog, a `roomgame` window). */
export function useRecordRoom(gameId: string, code: string): void {
  const recentRooms = useContext(RecentRoomsStoreContext);
  const { now } = useContext(NetworkDepsContext);
  useEffect(() => {
    recentRooms.record({ gameId, code }, now());
  }, [gameId, code, recentRooms, now]);
}
