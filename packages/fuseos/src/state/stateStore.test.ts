import type { AppState } from "./appState";
import { DEFAULT_STATE } from "./appState";
import {
  LocalStorageStateStore,
  MemoryStateStore,
  STATE_KEY,
} from "./stateStore";

const state: AppState = {
  version: 1,
  windows: [
    { id: "w1", kind: "paint", minimized: false, maximized: false },
    {
      id: "w2",
      kind: "dialog",
      title: "t",
      message: "m",
      icon: "info",
      minimized: false,
      maximized: false,
    },
  ],
};

class FakeStorage {
  items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.items.set(key, value);
  };
}

describe(LocalStorageStateStore.name, () => {
  it("writes under the versioned key and reads back without the dialogs", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageStateStore(storage);
    store.save(state);
    expect([...storage.items.keys()]).toEqual([STATE_KEY]);
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "paint",
    ]);
  });

  it("falls back to the default without storage, with a corrupt entry or when storage throws", () => {
    expect(new LocalStorageStateStore(undefined).load()).toBe(DEFAULT_STATE);
    const corrupt = new FakeStorage();
    corrupt.items.set(STATE_KEY, "{oops");
    expect(new LocalStorageStateStore(corrupt).load()).toBe(DEFAULT_STATE);
    const broken = new LocalStorageStateStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(broken.load()).toBe(DEFAULT_STATE);
    expect(() => broken.save(state)).not.toThrow();
  });
});

describe(MemoryStateStore.name, () => {
  it("starts from the given state, counts saves and round trips like storage would", () => {
    const store = new MemoryStateStore();
    expect(store.load()).toBe(DEFAULT_STATE);
    store.save(state);
    expect(store.saved).toBe(1);
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "paint",
    ]);
  });
});
