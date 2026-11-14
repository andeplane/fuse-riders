import {
  DEFAULT_SOUND_PREFS,
  LocalStorageSoundPrefsStore,
  MemorySoundPrefsStore,
  parseSoundPrefs,
  SOUND_PREFS_KEY,
  soundEnabled,
} from "./soundPrefsStore";

describe(parseSoundPrefs.name, () => {
  it("accepts the stored shape and ignores anything else", () => {
    expect(parseSoundPrefs(null)).toBe(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs("")).toBe(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs("not json")).toBe(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs("42")).toBe(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs("null")).toBe(DEFAULT_SOUND_PREFS);
    expect(
      parseSoundPrefs(
        JSON.stringify({
          master: false,
          events: { modem: false, floppy: "no", bogus: false, ding: true },
        }),
      ),
    ).toEqual({ master: false, events: { modem: false, ding: true } });
    expect(
      parseSoundPrefs(JSON.stringify({ master: "off", events: 3 })),
    ).toEqual({
      master: true,
      events: {},
    });
  });
});

describe(soundEnabled.name, () => {
  it("needs the master switch and no explicit off for the event", () => {
    expect(soundEnabled({ master: true, events: {} }, "ding")).toBe(true);
    expect(
      soundEnabled({ master: true, events: { ding: false } }, "ding"),
    ).toBe(false);
    expect(soundEnabled({ master: true, events: { ding: true } }, "ding")).toBe(
      true,
    );
    expect(soundEnabled({ master: false, events: {} }, "ding")).toBe(false);
  });

  it("keeps the start-up chime off until the user switches it on", () => {
    expect(soundEnabled({ master: true, events: {} }, "startup")).toBe(false);
    expect(
      soundEnabled({ master: true, events: { startup: true } }, "startup"),
    ).toBe(true);
    expect(
      soundEnabled({ master: true, events: { startup: false } }, "startup"),
    ).toBe(false);
    expect(
      soundEnabled({ master: false, events: { startup: true } }, "startup"),
    ).toBe(false);
  });

  it("gives prefs saved before the default changed the new default", () => {
    const old = JSON.stringify({ master: true, events: { modem: false } });
    expect(soundEnabled(parseSoundPrefs(old), "startup")).toBe(false);
  });
});

describe(LocalStorageSoundPrefsStore.name, () => {
  it("round-trips through storage under its key", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    const store = new LocalStorageSoundPrefsStore(storage);
    expect(store.get()).toBe(DEFAULT_SOUND_PREFS);
    store.set({ master: true, events: { modem: false } });
    expect(items.get(SOUND_PREFS_KEY)).toBe(
      '{"master":true,"events":{"modem":false}}',
    );
    expect(store.get()).toEqual({ master: true, events: { modem: false } });
  });

  it("survives storage that is missing or throws", () => {
    const none = new LocalStorageSoundPrefsStore(undefined);
    expect(none.get()).toBe(DEFAULT_SOUND_PREFS);
    none.set({ master: false, events: {} });
    const broken = new LocalStorageSoundPrefsStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(broken.get()).toBe(DEFAULT_SOUND_PREFS);
    expect(() => broken.set({ master: false, events: {} })).not.toThrow();
    const real = new LocalStorageSoundPrefsStore();
    real.set({ master: true, events: { error: false } });
    expect(real.get()).toEqual({ master: true, events: { error: false } });
    localStorage.removeItem(SOUND_PREFS_KEY);
  });
});

describe(MemorySoundPrefsStore.name, () => {
  it("holds what it is given", () => {
    const store = new MemorySoundPrefsStore();
    expect(store.get()).toBe(DEFAULT_SOUND_PREFS);
    const prefs = { master: false, events: {} };
    store.set(prefs);
    expect(store.get()).toBe(prefs);
  });
});
