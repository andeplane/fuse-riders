import { act, render, screen } from "@testing-library/react";

import type { FuseOsPrefs } from "./fuseosPrefsStore";
import {
  defaultGameLaunch,
  effectiveGameLaunch,
  FUSEOS_PREFS_KEY,
  FuseOsPrefsStoreContext,
  isGameLaunch,
  LocalStorageFuseOsPrefsStore,
  MemoryFuseOsPrefsStore,
  useFuseOsPrefs,
  WINDOW_LAUNCH_MIN_WIDTH,
} from "./fuseosPrefsStore";

class FakeStorage {
  items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.items.set(key, value);
  };
}

describe(defaultGameLaunch.name, () => {
  it("opens a window on a wide mouse-driven screen and a tab elsewhere", () => {
    expect(defaultGameLaunch({ finePointer: true, viewportWidth: 1440 })).toBe(
      "window",
    );
    expect(
      defaultGameLaunch({
        finePointer: true,
        viewportWidth: WINDOW_LAUNCH_MIN_WIDTH,
      }),
    ).toBe("window");
    expect(defaultGameLaunch({ finePointer: true, viewportWidth: 899 })).toBe(
      "tab",
    );
    expect(defaultGameLaunch({ finePointer: false, viewportWidth: 1440 })).toBe(
      "tab",
    );
  });

  it("lets a stored choice win over the device default", () => {
    const device = { finePointer: true, viewportWidth: 1440 };
    expect(effectiveGameLaunch({}, device)).toBe("window");
    expect(effectiveGameLaunch({ gameLaunch: "tab" }, device)).toBe("tab");
  });
});

describe(LocalStorageFuseOsPrefsStore.name, () => {
  it("round trips the launch choice and ignores anything else", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageFuseOsPrefsStore(storage);
    expect(store.get()).toEqual({});
    store.set({ gameLaunch: "tab" });
    expect([...storage.items.keys()]).toEqual([FUSEOS_PREFS_KEY]);
    expect(store.get()).toEqual({ gameLaunch: "tab" });
    // A store reads storage once, so each stored shape is checked through a fresh one.
    for (const stored of [
      JSON.stringify({ gameLaunch: "popup" }),
      JSON.stringify({ gameLaunch: 1 }),
      JSON.stringify("tab"),
      "nope",
      "null",
      "",
    ]) {
      storage.items.set(FUSEOS_PREFS_KEY, stored);
      expect(new LocalStorageFuseOsPrefsStore(storage).get(), stored).toEqual(
        {},
      );
    }
  });

  it("survives missing or throwing storage", () => {
    expect(new LocalStorageFuseOsPrefsStore(undefined).get()).toEqual({});
    const broken = new LocalStorageFuseOsPrefsStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(broken.get()).toEqual({});
    expect(() => broken.set({ gameLaunch: "window" })).not.toThrow();
  });

  it("reads storage once and hands back the same object until the next set", () => {
    const storage = new FakeStorage();
    storage.items.set(FUSEOS_PREFS_KEY, JSON.stringify({ gameLaunch: "tab" }));
    const store = new LocalStorageFuseOsPrefsStore(storage);
    const first = store.get();
    expect(first).toEqual({ gameLaunch: "tab" });
    expect(store.get()).toBe(first);
    storage.items.set(
      FUSEOS_PREFS_KEY,
      JSON.stringify({ gameLaunch: "window" }),
    );
    expect(store.get()).toBe(first);
    const seen: FuseOsPrefs[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.get()));
    store.set({});
    expect(seen).toEqual([{}]);
    unsubscribe();
    store.set({ gameLaunch: "window" });
    expect(seen).toEqual([{}]);
    expect(store.get()).toEqual({ gameLaunch: "window" });
  });
});

describe(MemoryFuseOsPrefsStore.name, () => {
  it("keeps what it is given and tells its subscribers", () => {
    const store = new MemoryFuseOsPrefsStore();
    const changes: FuseOsPrefs[] = [];
    const unsubscribe = store.subscribe(() => changes.push(store.get()));
    store.set({ gameLaunch: "window" });
    expect(store.get()).toEqual({ gameLaunch: "window" });
    expect(changes).toEqual([{ gameLaunch: "window" }]);
    unsubscribe();
    store.set({});
    expect(changes).toHaveLength(1);
    expect(isGameLaunch("window")).toBe(true);
    expect(isGameLaunch("desktop")).toBe(false);
  });
});

describe(useFuseOsPrefs.name, () => {
  function Launch() {
    const prefs = useFuseOsPrefs();
    return <output>{prefs.gameLaunch ?? "device"}</output>;
  }

  it("re-renders a reader when the store changes", () => {
    const store = new MemoryFuseOsPrefsStore();
    render(
      <FuseOsPrefsStoreContext.Provider value={store}>
        <Launch />
      </FuseOsPrefsStoreContext.Provider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("device");
    act(() => store.set({ gameLaunch: "tab" }));
    expect(screen.getByRole("status")).toHaveTextContent("tab");
  });
});
