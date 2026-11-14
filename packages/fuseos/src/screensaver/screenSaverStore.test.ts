import {
  DEFAULT_SCREEN_SAVER_PREFS,
  isScreenSaverKind,
  LocalStorageScreenSaverStore,
  MemoryScreenSaverStore,
  normalizeScreenSaverPrefs,
  parseScreenSaverPrefs,
  SCREEN_SAVER_KEY,
} from "./screenSaverStore";

describe("screen saver preferences", () => {
  it("defaults to 3D Pipes after five minutes and safely ignores corrupt or unavailable storage", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "bad",
      "[]",
      "42",
      '{"saver":"matrix"}',
    ])
      expect(parseScreenSaverPrefs(raw)).toEqual(DEFAULT_SCREEN_SAVER_PREFS);
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new LocalStorageScreenSaverStore(storage);
    expect(store.get()).toEqual(DEFAULT_SCREEN_SAVER_PREFS);
    expect(() =>
      store.set({ ...DEFAULT_SCREEN_SAVER_PREFS, saver: "none" }),
    ).not.toThrow();
    expect(new LocalStorageScreenSaverStore(undefined).get()).toEqual(
      DEFAULT_SCREEN_SAVER_PREFS,
    );
  });

  it("restores a valid preference, clamps the wait and replaces invalid fields one by one", () => {
    expect(
      parseScreenSaverPrefs(
        JSON.stringify({
          saver: "none",
          waitMinutes: 500,
          pipes: { joints: "cycle", teapots: false, multiple: false },
        }),
      ),
    ).toEqual({
      saver: "none",
      waitMinutes: 60,
      pipes: { joints: "cycle", teapots: false, multiple: false },
    });
    expect(
      parseScreenSaverPrefs(
        JSON.stringify({
          waitMinutes: 0.1,
          pipes: { joints: "torus", teapots: "yes" },
        }),
      ),
    ).toEqual({
      saver: "pipes",
      waitMinutes: 1,
      pipes: { joints: "mixed", teapots: true, multiple: true },
    });
    expect(
      parseScreenSaverPrefs(JSON.stringify({ waitMinutes: null, pipes: [] })),
    ).toEqual(DEFAULT_SCREEN_SAVER_PREFS);
    expect(
      normalizeScreenSaverPrefs({
        waitMinutes: Number.NaN,
        pipes: { multiple: false },
      }),
    ).toEqual({
      saver: "pipes",
      waitMinutes: 5,
      pipes: { joints: "mixed", teapots: true, multiple: false },
    });
    expect(normalizeScreenSaverPrefs({ waitMinutes: 2.4 }).waitMinutes).toBe(2);
    expect(isScreenSaverKind("pipes")).toBe(true);
    expect(isScreenSaverKind("none")).toBe(true);
    expect(isScreenSaverKind("flying-toasters")).toBe(false);
  });

  it("persists independent copies in the memory and browser stores", () => {
    const memory = new MemoryScreenSaverStore({ waitMinutes: 2 });
    expect(memory.get().waitMinutes).toBe(2);
    memory.set({
      saver: "none",
      waitMinutes: 3,
      pipes: { joints: "ball", teapots: false, multiple: true },
    });
    const stored = memory.get();
    stored.saver = "pipes";
    stored.pipes.joints = "elbow";
    expect(memory.get()).toEqual({
      saver: "none",
      waitMinutes: 3,
      pipes: { joints: "ball", teapots: false, multiple: true },
    });
    const values = new Map<string, string>();
    const browser = new LocalStorageScreenSaverStore({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    browser.set(memory.get());
    expect(values.has(SCREEN_SAVER_KEY)).toBe(true);
    expect(browser.get()).toEqual(memory.get());
  });
});
