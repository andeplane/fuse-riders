import type { RecentRoom } from "./recentRooms";
import {
  LocalStorageRecentRoomsStore,
  MemoryRecentRoomsStore,
  parseRecentRooms,
  RECENT_ROOMS_KEY,
  RECENT_ROOMS_MAX,
  withRecordedRoom,
} from "./recentRooms";

const T0 = Date.UTC(1998, 5, 25, 12, 0);

class FakeStorage {
  readonly items = new Map<string, string>();
  failing = false;
  getItem(key: string): string | null {
    if (this.failing) throw new Error("blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failing) throw new Error("full");
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    if (this.failing) throw new Error("blocked");
    this.items.delete(key);
  }
}

describe(parseRecentRooms.name, () => {
  it("keeps well-formed rooms and drops the rest", () => {
    const good: RecentRoom = { gameId: "fuseball", code: "AB42", lastSeen: T0 };
    expect(
      parseRecentRooms(
        JSON.stringify([
          good,
          { gameId: "fuseball", code: "ab42", lastSeen: T0 },
          { gameId: "Fuseball", code: "AB42", lastSeen: T0 },
          { gameId: "fuseball", code: "AB42", lastSeen: "yesterday" },
          { gameId: "fuseball", code: "AB42" },
          "AB42",
          null,
        ]),
      ),
    ).toEqual([good]);
  });

  it("is empty for nothing, a non-list or broken JSON", () => {
    expect(parseRecentRooms(null)).toEqual([]);
    expect(parseRecentRooms("")).toEqual([]);
    expect(parseRecentRooms("{}")).toEqual([]);
    expect(parseRecentRooms("[")).toEqual([]);
  });
});

describe(withRecordedRoom.name, () => {
  it("puts the room first, refreshes a repeat instead of duplicating it and caps the list", () => {
    let rooms: RecentRoom[] = [];
    for (let index = 0; index < RECENT_ROOMS_MAX + 5; index += 1)
      rooms = withRecordedRoom(
        rooms,
        { gameId: "fuseball", code: `AA${String(index).padStart(2, "0")}` },
        T0 + index,
      );
    expect(rooms).toHaveLength(RECENT_ROOMS_MAX);
    expect(rooms[0]).toEqual({
      gameId: "fuseball",
      code: "AA24",
      lastSeen: T0 + 24,
    });
    const refreshed = withRecordedRoom(
      rooms,
      { gameId: "fuseball", code: "AA10" },
      T0 + 100,
    );
    expect(refreshed).toHaveLength(RECENT_ROOMS_MAX);
    expect(refreshed[0]).toEqual({
      gameId: "fuseball",
      code: "AA10",
      lastSeen: T0 + 100,
    });
    expect(refreshed.filter((room) => room.code === "AA10")).toHaveLength(1);
  });

  it("tells the same code in two games apart", () => {
    const rooms = withRecordedRoom(
      withRecordedRoom([], { gameId: "fuseball", code: "AB42" }, T0),
      { gameId: "fuse-riders", code: "AB42" },
      T0 + 1,
    );
    expect(rooms.map((room) => room.gameId)).toEqual([
      "fuse-riders",
      "fuseball",
    ]);
  });
});

describe(MemoryRecentRoomsStore.name, () => {
  it("records, removes, clears and tells subscribers each time", () => {
    const store = new MemoryRecentRoomsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.record({ gameId: "fuseball", code: "AB42" }, T0);
    store.record({ gameId: "fuse-riders", code: "CD07" }, T0 + 1);
    expect(store.list().map((room) => room.code)).toEqual(["CD07", "AB42"]);
    store.remove({ gameId: "fuseball", code: "AB42" });
    expect(store.list().map((room) => room.code)).toEqual(["CD07"]);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    store.record({ gameId: "fuseball", code: "AB42" }, T0);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("ignores a code the service would never issue", () => {
    const store = new MemoryRecentRoomsStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.record({ gameId: "fuseball", code: "nope" }, T0);
    expect(store.list()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe(LocalStorageRecentRoomsStore.name, () => {
  it("round-trips through storage under its key and removes the key when empty", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageRecentRoomsStore(storage);
    store.record({ gameId: "fuseball", code: "AB42" }, T0);
    expect(parseRecentRooms(storage.getItem(RECENT_ROOMS_KEY))).toEqual([
      { gameId: "fuseball", code: "AB42", lastSeen: T0 },
    ]);
    expect(new LocalStorageRecentRoomsStore(storage).list()).toEqual([
      { gameId: "fuseball", code: "AB42", lastSeen: T0 },
    ]);
    store.remove({ gameId: "fuseball", code: "AB42" });
    expect(storage.getItem(RECENT_ROOMS_KEY)).toBeNull();
  });

  it("returns the same list until something changes", () => {
    const store = new LocalStorageRecentRoomsStore(new FakeStorage());
    const first = store.list();
    expect(store.list()).toBe(first);
    store.record({ gameId: "fuseball", code: "AB42" }, T0);
    expect(store.list()).not.toBe(first);
  });

  it("carries on in memory when storage is blocked or absent", () => {
    const storage = new FakeStorage();
    storage.failing = true;
    const store = new LocalStorageRecentRoomsStore(storage);
    expect(store.list()).toEqual([]);
    store.record({ gameId: "fuseball", code: "AB42" }, T0);
    expect(store.list().map((room) => room.code)).toEqual(["AB42"]);
    const absent = new LocalStorageRecentRoomsStore(undefined);
    absent.record({ gameId: "fuseball", code: "AB42" }, T0);
    expect(absent.list().map((room) => room.code)).toEqual(["AB42"]);
  });

  it("uses the browser's localStorage by default", () => {
    localStorage.removeItem(RECENT_ROOMS_KEY);
    const store = new LocalStorageRecentRoomsStore();
    store.record({ gameId: "fuseball", code: "AB42" }, T0);
    expect(localStorage.getItem(RECENT_ROOMS_KEY)).toContain("AB42");
    localStorage.removeItem(RECENT_ROOMS_KEY);
  });
});
