import { createContext } from "react";

/** A room the directory lists as open to join. */
export type LiveRoom = {
  gameId: string;
  code: string;
  /** Members currently in the room, when the directory knows. */
  members?: number;
};

export type RoomListing =
  /** The service has no way to list rooms; the window says so and offers joining by code. */
  | { kind: "unsupported"; reason: string }
  | { kind: "rooms"; rooms: readonly LiveRoom[] }
  | { kind: "error"; message: string };

/**
 * Where live or public rooms would come from. The room service (`packages/fuse-network-be`) exposes no
 * endpoint that enumerates rooms (its store reads one code at a time, and `/api/ready` reports only
 * socket counts), so the production directory is `UNSUPPORTED_ROOM_DIRECTORY`. The interface stays so
 * a later service version can plug one in without touching the window.
 */
export interface RoomDirectory {
  listRooms(gameId: string): Promise<RoomListing>;
}

export const NO_ROOM_LISTING_REASON =
  "The room service does not publish a list of rooms. Ask a friend for a code and use Join room.";

export const UNSUPPORTED_ROOM_DIRECTORY: RoomDirectory = {
  listRooms: () =>
    Promise.resolve({ kind: "unsupported", reason: NO_ROOM_LISTING_REASON }),
};

/** A directory with a fixed answer per game; tests and a future service adapter's fixture. */
export class MemoryRoomDirectory implements RoomDirectory {
  readonly calls: string[] = [];

  constructor(
    private readonly listings: Readonly<Record<string, RoomListing>> = {},
  ) {}

  listRooms(gameId: string): Promise<RoomListing> {
    this.calls.push(gameId);
    return Promise.resolve(
      this.listings[gameId] ?? { kind: "rooms", rooms: [] },
    );
  }
}

export const RoomDirectoryContext = createContext<RoomDirectory>(
  UNSUPPORTED_ROOM_DIRECTORY,
);
