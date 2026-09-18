/** Minimal typed storage surface used across the LAN client, satisfied by both safeStorage() and plain fakes in tests. */
export interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage that never throws; the safeStorage() fallback and a ready-made fake for tests. */
export function createMemoryStorage(): SafeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => (values.has(key) ? values.get(key)! : null),
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

/**
 * Wraps a browser Storage accessor (typically `() => localStorage` or `() => sessionStorage`) so a
 * blocked or unavailable store never crashes page startup. In Safari with "Block all cookies" and
 * some embedded webviews, merely evaluating `localStorage` throws a SecurityError — `access` is only
 * ever called lazily, inside a try/catch, at each get/set/remove, never at construction time. Falls
 * back to an in-memory store scoped to this wrapper instance.
 */
export function safeStorage(access: () => Storage): SafeStorage {
  const fallback = createMemoryStorage();
  return {
    getItem(key) {
      try {
        return access().getItem(key);
      } catch {
        return fallback.getItem(key);
      }
    },
    setItem(key, value) {
      try {
        access().setItem(key, value);
      } catch {
        fallback.setItem(key, value);
      }
    },
    removeItem(key) {
      try {
        access().removeItem(key);
      } catch {
        fallback.removeItem(key);
      }
    },
  };
}
