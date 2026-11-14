import { createContext } from "react";

import type { ImageMimeType } from "./paintTools";

/** What Save As remembers between sessions: per browser, never shared through links. */
export type PaintPrefs = { format?: ImageMimeType };

export interface PaintPrefsStore {
  get(): PaintPrefs;
  set(prefs: PaintPrefs): void;
}

export const PAINT_PREFS_KEY = "fuseos.paint";

function parsePrefs(raw: string | null | undefined): PaintPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record: Record<string, unknown> = { ...parsed };
    return {
      format:
        record.format === "image/png" || record.format === "image/jpeg"
          ? record.format
          : undefined,
    };
  } catch {
    return {};
  }
}

/** localStorage backed store; every access is guarded because storage can be unavailable. */
export class LocalStoragePaintPrefsStore implements PaintPrefsStore {
  constructor(
    private readonly storage:
      Pick<Storage, "getItem" | "setItem"> | undefined = safeLocalStorage(),
  ) {}

  get(): PaintPrefs {
    try {
      return parsePrefs(this.storage?.getItem(PAINT_PREFS_KEY));
    } catch {
      return {};
    }
  }

  set(prefs: PaintPrefs): void {
    try {
      this.storage?.setItem(PAINT_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked or full: the choice simply is not remembered.
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export class MemoryPaintPrefsStore implements PaintPrefsStore {
  private prefs: PaintPrefs = {};
  get(): PaintPrefs {
    return this.prefs;
  }
  set(prefs: PaintPrefs): void {
    this.prefs = prefs;
  }
}

export const PaintPrefsStoreContext = createContext<PaintPrefsStore>(
  new LocalStoragePaintPrefsStore(),
);
