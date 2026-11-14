/**
 * How many devices one room admits, per game. A room is sized for the game's own roster: every seat, every place in
 * its watching list, and one shared screen (a TV display is a member with neither). The seats and the watching list
 * are the game's own caps, kept in the shared log; this is only how many sockets the room service lets in, so a
 * device past it is told the room is full instead of joining a mesh that has no place for it.
 *
 * The room service counts the creator's seat apart from the rest (`maxGuests`), so each limit below is one less than
 * the sockets it stands for. `tests/room-limits.test.ts` reads every game's `seating` and fails when a game lists
 * more members than its room admits.
 */
const sockets = (seats: number, watchers: number): number =>
  seats + watchers + 1;

/** A game with no entry below: six seats (three a side), five watchers and a screen. */
export const DEFAULT_ROOM_SOCKETS = sockets(6, 5);

/** The games whose roster is not the default's, by game id. */
export const ROOM_SOCKETS: Readonly<Record<string, number>> = {
  "fuse-riders": sockets(5, 5),
  dice: sockets(5, 8),
  "fuse-lane": sockets(5, 8),
  "fuse-drivers": sockets(5, 8),
  "fuse-birds": sockets(5, 8),
  "fuse-front": sockets(6, 6),
  "fuse-craft": sockets(8, 4),
  "killer-fuse": sockets(6, 6),
};

/** The most devices a room of `gameId` admits, its creator included. */
export const roomSockets = (gameId: string): number =>
  ROOM_SOCKETS[gameId] ?? DEFAULT_ROOM_SOCKETS;

/** What the room service is configured with (`RoomStoreDependencies`). The refusal text is the service's own "Room full". */
export const ROOM_LIMITS = {
  maxGuests: DEFAULT_ROOM_SOCKETS - 1,
  gameMaxGuests: Object.fromEntries(
    Object.entries(ROOM_SOCKETS).map(([gameId, count]) => [gameId, count - 1]),
  ),
} as const;
