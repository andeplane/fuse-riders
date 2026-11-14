import {
  defaultGameLaunch,
  effectiveGameLaunch,
  FUSEOS_PREFS_KEY,
  isGameLaunch,
  LocalStorageFuseOsPrefsStore,
  MemoryFuseOsPrefsStore,
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
    storage.items.set(
      FUSEOS_PREFS_KEY,
      JSON.stringify({ gameLaunch: "popup" }),
    );
    expect(store.get()).toEqual({});
    storage.items.set(FUSEOS_PREFS_KEY, "nope");
    expect(store.get()).toEqual({});
    storage.items.set(FUSEOS_PREFS_KEY, "null");
    expect(store.get()).toEqual({});
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
});

describe(MemoryFuseOsPrefsStore.name, () => {
  it("keeps what it is given", () => {
    const store = new MemoryFuseOsPrefsStore();
    store.set({ gameLaunch: "window" });
    expect(store.get()).toEqual({ gameLaunch: "window" });
    expect(isGameLaunch("window")).toBe(true);
    expect(isGameLaunch("desktop")).toBe(false);
  });
});
