import {
  LocalStorageY2kRunStore,
  MemoryY2kRunStore,
  Y2K_RUN_KEY,
} from "./y2kRunStore";

class FakeStorage {
  values = new Map<string, string>();
  getItem = (key: string): string | null => this.values.get(key) ?? null;
  setItem = (key: string, value: string): void => {
    this.values.set(key, value);
  };
}

class BrokenStorage {
  getItem = (): string | null => {
    throw new Error("SecurityError");
  };
  setItem = (): void => {
    throw new Error("QuotaExceededError");
  };
}

describe(LocalStorageY2kRunStore.name, () => {
  it("starts with no run and remembers the day it is given", () => {
    const storage = new FakeStorage();
    const store = new LocalStorageY2kRunStore(storage);
    expect(store.lastRun()).toBeNull();
    store.markRun("1999-12-31");
    expect(store.lastRun()).toBe("1999-12-31");
    expect(storage.values.get(Y2K_RUN_KEY)).toBe("1999-12-31");
  });

  it("treats an empty value as never run", () => {
    const storage = new FakeStorage();
    storage.setItem(Y2K_RUN_KEY, "");
    expect(new LocalStorageY2kRunStore(storage).lastRun()).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    const broken = new LocalStorageY2kRunStore(new BrokenStorage());
    expect(broken.lastRun()).toBeNull();
    expect(() => broken.markRun("2000-01-01")).not.toThrow();
    const missing = new LocalStorageY2kRunStore(undefined);
    expect(missing.lastRun()).toBeNull();
    expect(() => missing.markRun("2000-01-01")).not.toThrow();
  });

  it("uses the page's localStorage by default", () => {
    localStorage.removeItem(Y2K_RUN_KEY);
    const store = new LocalStorageY2kRunStore();
    expect(store.lastRun()).toBeNull();
    store.markRun("2000-01-01");
    expect(localStorage.getItem(Y2K_RUN_KEY)).toBe("2000-01-01");
    localStorage.removeItem(Y2K_RUN_KEY);
  });
});

describe(MemoryY2kRunStore.name, () => {
  it("holds the last day in memory", () => {
    const store = new MemoryY2kRunStore();
    expect(store.lastRun()).toBeNull();
    store.markRun("2000-01-01");
    expect(store.lastRun()).toBe("2000-01-01");
    expect(new MemoryY2kRunStore("1999-12-31").lastRun()).toBe("1999-12-31");
  });
});
