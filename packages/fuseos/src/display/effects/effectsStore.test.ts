import {
  CRT_MODES,
  DEFAULT_DISPLAY_EFFECTS,
  DISPLAY_EFFECTS_KEY,
  isCrtMode,
  LocalStorageDisplayEffectsStore,
  MemoryDisplayEffectsStore,
  parseDisplayEffects,
} from "./effectsStore";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function fakeStorage(initial: Record<string, string> = {}): Storage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("display effects store", () => {
  it("knows the three CRT modes", () => {
    expect(CRT_MODES.map((mode) => mode.value)).toEqual([
      "off",
      "scanlines",
      "full",
    ]);
    expect(isCrtMode("full")).toBe(true);
    expect(isCrtMode("plasma")).toBe(false);
  });

  it("parses stored effects, falling back field by field", () => {
    expect(parseDisplayEffects(null)).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(parseDisplayEffects("")).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(parseDisplayEffects("not json")).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(parseDisplayEffects("42")).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(parseDisplayEffects("null")).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(
      parseDisplayEffects(
        JSON.stringify({ crt: "full", curvature: true, scheme: "rose" }),
      ),
    ).toEqual({ crt: "full", curvature: true, scheme: "rose" });
    expect(
      parseDisplayEffects(
        JSON.stringify({ crt: "lcd", curvature: "yes", scheme: "aqua" }),
      ),
    ).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(parseDisplayEffects(JSON.stringify({ crt: "scanlines" }))).toEqual({
      ...DEFAULT_DISPLAY_EFFECTS,
      crt: "scanlines",
    });
  });

  it("round-trips through localStorage under its own key", () => {
    const storage = fakeStorage();
    const store = new LocalStorageDisplayEffectsStore(storage);
    expect(store.get()).toEqual(DEFAULT_DISPLAY_EFFECTS);
    store.set({ crt: "scanlines", curvature: false, scheme: "slate" });
    expect(storage.data.get(DISPLAY_EFFECTS_KEY)).toBe(
      JSON.stringify({ crt: "scanlines", curvature: false, scheme: "slate" }),
    );
    expect(new LocalStorageDisplayEffectsStore(storage).get()).toEqual({
      crt: "scanlines",
      curvature: false,
      scheme: "slate",
    });
  });

  it("survives storage that is missing or throws", () => {
    const missing = new LocalStorageDisplayEffectsStore(undefined);
    expect(missing.get()).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(() =>
      missing.set({ crt: "full", curvature: true, scheme: "rose" }),
    ).not.toThrow();
    const broken: Storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = new LocalStorageDisplayEffectsStore(broken);
    expect(store.get()).toEqual(DEFAULT_DISPLAY_EFFECTS);
    expect(() =>
      store.set({ crt: "full", curvature: true, scheme: "rose" }),
    ).not.toThrow();
  });

  it("keeps effects in memory for tests", () => {
    const store = new MemoryDisplayEffectsStore();
    expect(store.get()).toEqual(DEFAULT_DISPLAY_EFFECTS);
    store.set({ crt: "full", curvature: true, scheme: "hot-dog-stand" });
    expect(store.get().scheme).toBe("hot-dog-stand");
    expect(
      new MemoryDisplayEffectsStore({
        crt: "off",
        curvature: false,
        scheme: "rose",
      }).get().scheme,
    ).toBe("rose");
  });
});
