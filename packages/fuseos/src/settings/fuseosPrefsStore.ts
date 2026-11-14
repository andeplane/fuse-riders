import { createContext } from "react";

/** Where a Fuse game opens from the desktop: in a window on this desktop, or in a browser tab of its own. */
export type GameLaunch = "window" | "tab";

export type FuseOsPrefs = {
  /** Absent means "decide from the device" (`defaultGameLaunch`). */
  gameLaunch?: GameLaunch;
};

export interface FuseOsPrefsStore {
  get(): FuseOsPrefs;
  set(prefs: FuseOsPrefs): void;
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

/** localStorage backed; every access is guarded because storage can be unavailable. */
export class LocalStorageFuseOsPrefsStore implements FuseOsPrefsStore {
  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {}

  get(): FuseOsPrefs {
    try {
      return parsePrefs(this.storage?.getItem(FUSEOS_PREFS_KEY));
    } catch {
      return {};
    }
  }

  set(prefs: FuseOsPrefs): void {
    try {
      this.storage?.setItem(FUSEOS_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked or full: the choice simply is not remembered.
    }
  }
}

export class MemoryFuseOsPrefsStore implements FuseOsPrefsStore {
  constructor(private prefs: FuseOsPrefs = {}) {}
  get(): FuseOsPrefs {
    return this.prefs;
  }
  set(prefs: FuseOsPrefs): void {
    this.prefs = prefs;
  }
}

export const FuseOsPrefsStoreContext = createContext<FuseOsPrefsStore>(
  new LocalStorageFuseOsPrefsStore(),
);
