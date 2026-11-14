import { createContext } from "react";

import { isRoomCode } from "./roomCode";

/** A room this browser joined or opened: enough to offer it again. Never sent anywhere. */
export type RecentRoom = {
  gameId: string;
  code: string;
  /** Epoch milliseconds of the last time the room was seen. */
  lastSeen: number;
};

export type RecentRoomTarget = Pick<RecentRoom, "gameId" | "code">;

/** The rooms this browser played recently; newest first. Lives in local storage only. */
export interface RecentRoomsStore {
  list(): readonly RecentRoom[];
  /** Adds or refreshes a room; the newest room comes first, the oldest beyond the cap drops off. */
  record(room: RecentRoomTarget, seenAt: number): void;
  remove(room: RecentRoomTarget): void;
  clear(): void;
  /** Called after every change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const RECENT_ROOMS_KEY = "fuseos.network.recentRooms";

/** Enough for a few evenings of play without turning the window into a log. */
export const RECENT_ROOMS_MAX = 20;

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isRecentRoom(value: unknown): value is RecentRoom {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.gameId === "string" &&
    GAME_ID_PATTERN.test(record.gameId) &&
    isRoomCode(record.code) &&
    typeof record.lastSeen === "number" &&
    Number.isFinite(record.lastSeen)
  );
}

/** Parses a stored list, dropping anything that is not a room; a corrupt entry means an empty list. */
export function parseRecentRooms(raw: string | null | undefined): RecentRoom[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentRoom) : [];
  } catch {
    return [];
  }
}

function sameRoom(a: RecentRoomTarget, b: RecentRoomTarget): boolean {
  return a.gameId === b.gameId && a.code === b.code;
}

/** The list with `room` recorded at `seenAt`: moved to the front, capped. Pure, for both stores. */
export function withRecordedRoom(
  rooms: readonly RecentRoom[],
  room: RecentRoomTarget,
  seenAt: number,
): RecentRoom[] {
  return [
    { gameId: room.gameId, code: room.code, lastSeen: seenAt },
    ...rooms.filter((entry) => !sameRoom(entry, room)),
  ].slice(0, RECENT_ROOMS_MAX);
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

abstract class BaseRecentRoomsStore implements RecentRoomsStore {
  private readonly listeners = new Set<() => void>();

  abstract list(): readonly RecentRoom[];
  protected abstract write(rooms: readonly RecentRoom[]): void;

  record(room: RecentRoomTarget, seenAt: number): void {
    if (!isRoomCode(room.code)) return;
    this.write(withRecordedRoom(this.list(), room, seenAt));
    this.notify();
  }

  remove(room: RecentRoomTarget): void {
    this.write(this.list().filter((entry) => !sameRoom(entry, room)));
    this.notify();
  }

  clear(): void {
    this.write([]);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** localStorage backed; every access is guarded because storage can be unavailable or full. */
export class LocalStorageRecentRoomsStore extends BaseRecentRoomsStore {
  /** The last list written or read, so `list()` is referentially stable between changes. */
  private cached: readonly RecentRoom[] | undefined;

  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {
    super();
  }

  list(): readonly RecentRoom[] {
    if (this.cached) return this.cached;
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(RECENT_ROOMS_KEY);
    } catch {
      raw = undefined;
    }
    this.cached = parseRecentRooms(raw);
    return this.cached;
  }

  protected write(rooms: readonly RecentRoom[]): void {
    this.cached = rooms;
    try {
      if (rooms.length === 0) this.storage?.removeItem(RECENT_ROOMS_KEY);
      else this.storage?.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms));
    } catch {
      // Storage blocked or full: the list lives on in memory for this session only.
    }
  }
}

export class MemoryRecentRoomsStore extends BaseRecentRoomsStore {
  constructor(private rooms: readonly RecentRoom[] = []) {
    super();
  }

  list(): readonly RecentRoom[] {
    return this.rooms;
  }

  protected write(rooms: readonly RecentRoom[]): void {
    this.rooms = rooms;
  }
}

export const RecentRoomsStoreContext = createContext<RecentRoomsStore>(
  new LocalStorageRecentRoomsStore(),
);
