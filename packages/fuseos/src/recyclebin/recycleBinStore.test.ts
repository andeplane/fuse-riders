import { RECYCLE_BIN_ITEMS } from "./recycleBinItems";
import {
  binContents,
  EMPTY_RECYCLE_BIN_STATE,
  isRecycleBinState,
  LocalStorageRecycleBinStore,
  MemoryRecycleBinStore,
  parseRecycleBinState,
  RECYCLE_BIN_KEY,
  withoutItems,
} from "./recycleBinStore";

class FakeStorage {
  items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.items.set(key, value);
  };
}

class BrokenStorage {
  getItem = (): string | null => {
    throw new Error("blocked");
  };
  setItem = (): void => {
    throw new Error("blocked");
  };
}

describe(parseRecycleBinState.name, () => {
  it("accepts the stored shape, deduplicating ids, and falls back to a full bin otherwise", () => {
    expect(parseRecycleBinState(null)).toBe(EMPTY_RECYCLE_BIN_STATE);
    expect(parseRecycleBinState("")).toBe(EMPTY_RECYCLE_BIN_STATE);
    expect(parseRecycleBinState("not json")).toBe(EMPTY_RECYCLE_BIN_STATE);
    expect(parseRecycleBinState("42")).toBe(EMPTY_RECYCLE_BIN_STATE);
    expect(
      parseRecycleBinState(JSON.stringify({ version: 2, removed: [] })),
    ).toBe(EMPTY_RECYCLE_BIN_STATE);
    expect(
      parseRecycleBinState(JSON.stringify({ version: 1, removed: [1] })),
    ).toBe(EMPTY_RECYCLE_BIN_STATE);
    expect(
      parseRecycleBinState(
        JSON.stringify({ version: 1, removed: ["todo", "todo", "debbie"] }),
      ),
    ).toEqual({ version: 1, removed: ["todo", "debbie"] });
  });

  it("recognises the state shape", () => {
    expect(isRecycleBinState({ version: 1, removed: [] })).toBe(true);
    expect(isRecycleBinState({ version: 1 })).toBe(false);
    expect(isRecycleBinState(null)).toBe(false);
  });
});

describe(binContents.name, () => {
  it("lists the catalogue minus what left the bin, in catalogue order", () => {
    expect(binContents(EMPTY_RECYCLE_BIN_STATE)).toEqual(RECYCLE_BIN_ITEMS);
    const state = withoutItems(EMPTY_RECYCLE_BIN_STATE, [
      "todo",
      "beach-volley",
    ]);
    const names = binContents(state).map((item) => item.name);
    expect(names).not.toContain("TODO_before_launch.txt");
    expect(names).not.toContain("Fuse_Volley_Beach_Edition_UNCUT.avi");
    expect(names).toHaveLength(RECYCLE_BIN_ITEMS.length - 2);
  });

  it("removes without duplicating ids already gone", () => {
    const once = withoutItems(EMPTY_RECYCLE_BIN_STATE, ["todo"]);
    expect(withoutItems(once, ["todo", "sleep"])).toEqual({
      version: 1,
      removed: ["todo", "sleep"],
    });
  });
});

describe(LocalStorageRecycleBinStore.name, () => {
  it("round trips through storage under its own key and notifies subscribers", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageRecycleBinStore(storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toEqual(EMPTY_RECYCLE_BIN_STATE);

    store.set(withoutItems(store.get(), ["todo"]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...storage.items.keys()]).toEqual([RECYCLE_BIN_KEY]);
    expect(new LocalStorageRecycleBinStore(storage).get()).toEqual({
      version: 1,
      removed: ["todo"],
    });

    unsubscribe();
    store.set(EMPTY_RECYCLE_BIN_STATE);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns the same state object until the next set, as useSyncExternalStore needs", () => {
    const store = new LocalStorageRecycleBinStore(new FakeStorage());
    expect(store.get()).toBe(store.get());
  });

  it("treats blocked or missing storage as a full bin and keeps working in memory", () => {
    const broken = new LocalStorageRecycleBinStore(new BrokenStorage());
    expect(broken.get()).toEqual(EMPTY_RECYCLE_BIN_STATE);
    broken.set(withoutItems(EMPTY_RECYCLE_BIN_STATE, ["todo"]));
    expect(broken.get().removed).toEqual(["todo"]);

    const missing = new LocalStorageRecycleBinStore(undefined);
    expect(missing.get()).toEqual(EMPTY_RECYCLE_BIN_STATE);
    missing.set(withoutItems(EMPTY_RECYCLE_BIN_STATE, ["sleep"]));
    expect(missing.get().removed).toEqual(["sleep"]);
  });
});

describe(MemoryRecycleBinStore.name, () => {
  it("holds the state in memory and notifies subscribers", () => {
    const store = new MemoryRecycleBinStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.get()).toEqual(EMPTY_RECYCLE_BIN_STATE);
    store.set(withoutItems(store.get(), ["todo"]));
    expect(store.get().removed).toEqual(["todo"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
