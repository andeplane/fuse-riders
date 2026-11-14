import { createContext, useContext, useSyncExternalStore } from "react";

/** Where a Fuse game opens from the desktop: in a window on this desktop, or in a browser tab of its own. */
export type GameLaunch = "window" | "tab";

export type FuseOsPrefs = {
  /** Absent means "decide from the device" (`defaultGameLaunch`). */
  gameLaunch?: GameLaunch;
};

export interface FuseOsPrefsStore {
  /** The same object until the next `set`, so React can compare it by identity. */
  get(): FuseOsPrefs;
  set(prefs: FuseOsPrefs): void;
  /** Calls `listener` after every `set` on this page; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const FUSEOS_PREFS_KEY = "fuseos.prefs";

/** Narrower than this, a game window would be smaller than the game's own phone layout; a tab serves it better. */
export const WINDOW_LAUNCH_MIN_WIDTH = 900;

export function isGameLaunch(value: unknown): value is GameLaunch {
  return value === "window" || value === "tab";
}

function parsePrefs(raw: string | null | undefined): FuseOsPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record: Record<string, unknown> = { ...parsed };
    return isGameLaunch(record.gameLaunch)
      ? { gameLaunch: record.gameLaunch }
      : {};
  } catch {
    return {};
  }
}

/** Mouse-driven and wide enough for a window: the desktop. Touch or narrow: a tab, where the game's phone layout works. */
export function defaultGameLaunch(device: {
  finePointer: boolean;
  viewportWidth: number;
}): GameLaunch {
  return device.finePointer && device.viewportWidth >= WINDOW_LAUNCH_MIN_WIDTH
    ? "window"
    : "tab";
}

/** The launch mode in force: the user's choice when there is one, else the device default. */
export function effectiveGameLaunch(
  prefs: FuseOsPrefs,
  device: { finePointer: boolean; viewportWidth: number },
): GameLaunch {
  return prefs.gameLaunch ?? defaultGameLaunch(device);
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

class Listeners {
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * localStorage backed; every access is guarded because storage can be unavailable. Reads once and keeps the
 * result, so `get` is stable between sets and a page never re-parses storage on every render.
 */
export class LocalStorageFuseOsPrefsStore implements FuseOsPrefsStore {
  private cached: FuseOsPrefs | undefined;
  private readonly listeners = new Listeners();

  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {}

  get(): FuseOsPrefs {
    if (this.cached) return this.cached;
    try {
      this.cached = parsePrefs(this.storage?.getItem(FUSEOS_PREFS_KEY));
    } catch {
      this.cached = {};
    }
    return this.cached;
  }

  set(prefs: FuseOsPrefs): void {
    this.cached = prefs;
    try {
      this.storage?.setItem(FUSEOS_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked or full: the choice holds for this page and simply is not remembered.
    }
    this.listeners.notify();
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }
}

export class MemoryFuseOsPrefsStore implements FuseOsPrefsStore {
  private readonly listeners = new Listeners();
  constructor(private prefs: FuseOsPrefs = {}) {}
  get(): FuseOsPrefs {
    return this.prefs;
  }
  set(prefs: FuseOsPrefs): void {
    this.prefs = prefs;
    this.listeners.notify();
  }
  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }
}

export const FuseOsPrefsStoreContext = createContext<FuseOsPrefsStore>(
  new LocalStorageFuseOsPrefsStore(),
);

/** The preferences as stored, re-rendering whoever reads them when they change. */
export function useFuseOsPrefs(): FuseOsPrefs {
  const store = useContext(FuseOsPrefsStoreContext);
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
  );
}
