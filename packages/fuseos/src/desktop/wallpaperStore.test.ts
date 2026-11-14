import {
  LocalStorageWallpaperStore,
  MemoryWallpaperStore,
  WALLPAPER_KEY,
} from "./wallpaperStore";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
  };
}

describe(LocalStorageWallpaperStore.name, () => {
  it("stores and clears image data urls", () => {
    const storage = fakeStorage();
    const store = new LocalStorageWallpaperStore(storage);
    expect(store.get()).toBeUndefined();
    store.set("data:image/png;base64,AAAA");
    expect(storage.setItem).toHaveBeenCalledWith(
      WALLPAPER_KEY,
      "data:image/png;base64,AAAA",
    );
    expect(store.get()).toBe("data:image/png;base64,AAAA");
    store.set(undefined);
    expect(storage.removeItem).toHaveBeenCalledWith(WALLPAPER_KEY);
    expect(store.get()).toBeUndefined();
  });

  it("ignores values that are not images and survives broken storage", () => {
    const storage = fakeStorage();
    storage.getItem.mockReturnValue("javascript:alert(1)");
    expect(new LocalStorageWallpaperStore(storage).get()).toBeUndefined();

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new LocalStorageWallpaperStore(broken);
    expect(store.get()).toBeUndefined();
    expect(() => store.set("data:image/png;base64,AAAA")).not.toThrow();
    expect(new LocalStorageWallpaperStore(undefined).get()).toBeUndefined();
  });
});

describe(MemoryWallpaperStore.name, () => {
  it("keeps the value in memory", () => {
    const store = new MemoryWallpaperStore();
    store.set("data:image/png;base64,BB");
    expect(store.get()).toBe("data:image/png;base64,BB");
  });
});
