import {
  LAST_PLAYED_KEY,
  LocalStorageLastPlayedStore,
  MemoryLastPlayedStore,
  parseLastPlayed,
} from "./lastPlayedStore";

class FakeStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly items = new Map<string, string>();
  constructor(private readonly failing = false) {}
  getItem(key: string): string | null {
    if (this.failing) throw new Error("blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failing) throw new Error("blocked");
    this.items.set(key, value);
  }
}

describe(parseLastPlayed.name, () => {
  it("keeps finite timestamps by game id and drops everything else", () => {
    expect(parseLastPlayed(null)).toEqual({});
    expect(parseLastPlayed("")).toEqual({});
    expect(parseLastPlayed("not json")).toEqual({});
    expect(parseLastPlayed("[1,2]")).toEqual({});
    expect(parseLastPlayed('"x"')).toEqual({});
    expect(
      parseLastPlayed(
        '{"fuseball": 1000, "fuse-riders": "soon", "fuse-birds": null, "x": 1e999}',
      ),
    ).toEqual({ fuseball: 1000 });
  });
});

describe(LocalStorageLastPlayedStore.name, () => {
  it("records launches under its key and reads them back", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageLastPlayedStore(storage);
    expect(store.get()).toEqual({});
    store.record("fuseball", 1000);
    store.record("fuse-riders", 2000);
    store.record("fuseball", 3000);
    expect(store.get()).toEqual({ fuseball: 3000, "fuse-riders": 2000 });
    expect(JSON.parse(storage.items.get(LAST_PLAYED_KEY) ?? "{}")).toEqual({
      fuseball: 3000,
      "fuse-riders": 2000,
    });
  });

  it("is empty and silent when storage is unavailable or throws", () => {
    expect(new LocalStorageLastPlayedStore(undefined).get()).toEqual({});
    const blocked = new LocalStorageLastPlayedStore(new FakeStorage(true));
    expect(blocked.get()).toEqual({});
    expect(() => blocked.record("fuseball", 1)).not.toThrow();
  });
});

describe(MemoryLastPlayedStore.name, () => {
  it("starts from the given map and records without mutating it", () => {
    const initial = { fuseball: 1 };
    const store = new MemoryLastPlayedStore(initial);
    store.record("fuse-riders", 2);
    expect(store.get()).toEqual({ fuseball: 1, "fuse-riders": 2 });
    expect(initial).toEqual({ fuseball: 1 });
  });
});
