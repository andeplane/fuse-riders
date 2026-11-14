import {
  daysUsed,
  DEFAULT_FAVORITES,
  defaultPrefs,
  identFor,
  isValidNick,
  LocalStorageMircPrefsStore,
  MemoryMircPrefsStore,
  MIRC_PREFS_KEY,
  parsePrefs,
} from "./mircPrefs";

const FALLBACK = defaultPrefs(() => 0.1234, 1000);

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
}

describe("mIRC prefs", () => {
  it("starts with a Guest nick, EFnet and the Channels Folder favourites", () => {
    expect(FALLBACK).toMatchObject({
      nick: "Guest1234",
      altNick: "Guest1234_",
      networkId: "efnet",
      invisible: true,
      timestamps: false,
      favorites: DEFAULT_FAVORITES,
      firstRun: 1000,
    });
  });

  it("validates every stored field and keeps the good ones", () => {
    const stored = JSON.stringify({
      nick: "Zero_Cool",
      altNick: "has space",
      realName: "x".repeat(101),
      email: "dade@example.net",
      networkId: "nowhere",
      invisible: "yes",
      timestamps: true,
      folderOnConnect: false,
      favorites: ["#ok", "bad", 7, "#also-ok"],
      firstRun: 5,
    });
    expect(parsePrefs(stored, FALLBACK)).toEqual({
      ...FALLBACK,
      nick: "Zero_Cool",
      email: "dade@example.net",
      timestamps: true,
      folderOnConnect: false,
      favorites: ["#ok", "#also-ok"],
      firstRun: 5,
    });
  });

  it("falls back for missing, corrupt or non-object data", () => {
    expect(parsePrefs(undefined, FALLBACK)).toBe(FALLBACK);
    expect(parsePrefs("{nope", FALLBACK)).toBe(FALLBACK);
    expect(parsePrefs("42", FALLBACK)).toBe(FALLBACK);
    expect(parsePrefs(JSON.stringify({ altNick: "", firstRun: "x" }), FALLBACK)).toEqual({ ...FALLBACK, altNick: "" });
  });

  it("checks nicks the way servers do", () => {
    expect(isValidNick("[Neo]")).toBe(true);
    expect(isValidNick("9lives")).toBe(false);
    expect(isValidNick("a b")).toBe(false);
  });

  it("derives the ident from the e-mail's local part, else the nick", () => {
    expect(identFor({ email: "acid@burn.org", nick: "x" })).toBe("acid");
    expect(identFor({ email: "", nick: "Neo" })).toBe("Neo");
  });

  it("counts days used from the first run, starting at day 1", () => {
    expect(daysUsed(0, 0)).toBe(1);
    expect(daysUsed(0, 86_400_000 * 31)).toBe(32);
  });

  it("stores in memory", () => {
    const store = new MemoryMircPrefsStore();
    expect(store.get()).toBeUndefined();
    store.set(FALLBACK);
    expect(store.get()).toBe(FALLBACK);
  });

  it("stores in localStorage and survives blocked storage", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageMircPrefsStore(storage, () => FALLBACK);
    expect(store.get()).toBeUndefined();
    store.set({ ...FALLBACK, nick: "Acid_Burn" });
    expect(storage.items.get(MIRC_PREFS_KEY)).toContain("Acid_Burn");
    expect(store.get()?.nick).toBe("Acid_Burn");
    storage.failing = true;
    expect(store.get()).toBeUndefined();
    expect(() => store.set(FALLBACK)).not.toThrow();
    expect(new LocalStorageMircPrefsStore(undefined, () => FALLBACK).get()).toBeUndefined();
  });
});
