import {
  ASSISTANT_OPTIONS_KEY,
  DEFAULT_ASSISTANT_OPTIONS,
  LocalStorageAssistantOptionsStore,
  MemoryAssistantOptionsStore,
  parseAssistantOptions,
} from "./assistantOptionsStore";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
  };
}

describe(parseAssistantOptions.name, () => {
  it("fills in defaults for missing, wrong or broken values", () => {
    expect(parseAssistantOptions(undefined)).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    expect(parseAssistantOptions("{oops")).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    expect(parseAssistantOptions("42")).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    expect(
      parseAssistantOptions(
        JSON.stringify({
          narrate: false,
          animate: "yes",
          greeted: true,
          sounds: true,
          stale: 1,
        }),
      ),
    ).toEqual({
      showTips: true,
      narrate: false,
      animate: true,
      sounds: true,
      greeted: true,
    });
    expect(
      Object.keys(
        parseAssistantOptions(JSON.stringify({ agentExternalId: "my-agent" })),
      ).sort(),
    ).toEqual(["animate", "greeted", "narrate", "showTips", "sounds"]);
  });
});

describe(LocalStorageAssistantOptionsStore.name, () => {
  it("uses the fuseos.assistant storage key", () => {
    expect(ASSISTANT_OPTIONS_KEY).toBe("fuseos.assistant");
  });

  it("stores and reads the options", () => {
    const storage = fakeStorage();
    const store = new LocalStorageAssistantOptionsStore(storage);
    expect(store.get()).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    store.set({ ...DEFAULT_ASSISTANT_OPTIONS, showTips: false, greeted: true });
    expect(storage.setItem).toHaveBeenCalledWith(
      ASSISTANT_OPTIONS_KEY,
      JSON.stringify({
        ...DEFAULT_ASSISTANT_OPTIONS,
        showTips: false,
        greeted: true,
      }),
    );
    expect(store.get()).toEqual({
      ...DEFAULT_ASSISTANT_OPTIONS,
      showTips: false,
      greeted: true,
    });
  });

  it("survives broken or missing storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = new LocalStorageAssistantOptionsStore(broken);
    expect(store.get()).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    expect(() => store.set(DEFAULT_ASSISTANT_OPTIONS)).not.toThrow();
    expect(new LocalStorageAssistantOptionsStore(undefined).get()).toEqual(
      DEFAULT_ASSISTANT_OPTIONS,
    );
  });
});

describe(MemoryAssistantOptionsStore.name, () => {
  it("keeps the options in memory", () => {
    const store = new MemoryAssistantOptionsStore();
    store.set({ ...DEFAULT_ASSISTANT_OPTIONS, animate: false });
    expect(store.get().animate).toBe(false);
    expect(
      new MemoryAssistantOptionsStore({
        ...DEFAULT_ASSISTANT_OPTIONS,
        greeted: true,
      }).get().greeted,
    ).toBe(true);
  });
});
