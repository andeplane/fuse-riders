/** Remembers which local day the millennium bug last struck, so it strikes once a day at most. */
export interface Y2kRunStore {
  /** The `LocalCalendar.dayKey` of the last run, or null when it never ran. */
  lastRun(): string | null;
  markRun(dayKey: string): void;
}

export const Y2K_RUN_KEY = "fuseos.y2k";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** localStorage backed; every access is guarded because storage can be unavailable. */
export class LocalStorageY2kRunStore implements Y2kRunStore {
  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {}

  lastRun(): string | null {
    try {
      const value = this.storage?.getItem(Y2K_RUN_KEY);
      return typeof value === "string" && value !== "" ? value : null;
    } catch {
      return null;
    }
  }

  markRun(dayKey: string): void {
    try {
      this.storage?.setItem(Y2K_RUN_KEY, dayKey);
    } catch {
      // Storage full or disabled: the bug may strike again tomorrow, which is harmless.
    }
  }
}

export class MemoryY2kRunStore implements Y2kRunStore {
  constructor(private day: string | null = null) {}

  lastRun(): string | null {
    return this.day;
  }

  markRun(dayKey: string): void {
    this.day = dayKey;
  }
}
