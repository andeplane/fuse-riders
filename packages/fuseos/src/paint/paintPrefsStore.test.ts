import { LocalStoragePaintPrefsStore, MemoryPaintPrefsStore, PAINT_PREFS_KEY } from './paintPrefsStore';

describe(LocalStoragePaintPrefsStore.name, () => {
  it('round trips the format', () => {
    const storage = new Map<string, string>();
    const store = new LocalStoragePaintPrefsStore({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
    expect(store.get()).toEqual({});
    store.set({ format: 'image/jpeg' });
    expect(storage.get(PAINT_PREFS_KEY)).toBe('{"format":"image/jpeg"}');
    expect(store.get()).toEqual({ format: 'image/jpeg' });
  });

  it('ignores garbage and unknown formats', () => {
    const values = ['{not json', '[]', '{"format":"image/gif"}', '"x"'];
    values.forEach((value) => {
      const store = new LocalStoragePaintPrefsStore({ getItem: () => value, setItem: () => undefined });
      expect(store.get()).toEqual({ format: undefined });
    });
  });

  it('survives storage that throws or is missing', () => {
    const throwing = new LocalStoragePaintPrefsStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(throwing.get()).toEqual({});
    expect(() => throwing.set({ format: 'image/png' })).not.toThrow();
    expect(new LocalStoragePaintPrefsStore(undefined).get()).toEqual({});
  });
});

describe(MemoryPaintPrefsStore.name, () => {
  it('remembers the last value', () => {
    const store = new MemoryPaintPrefsStore();
    store.set({ format: 'image/png' });
    expect(store.get()).toEqual({ format: 'image/png' });
  });
});
