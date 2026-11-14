import { createContext } from "react";

/**
 * Where a wallpaper came from: browsed from a file, a camera photo, "Set as
 * wallpaper" in Paint, or cleared back to the solid desktop colour. Kept in
 * memory only (not persisted), so a reload with a stored wallpaper reports
 * 'file' since the original source is not known.
 */
export type WallpaperSource = "file" | "camera" | "paint" | "none";

/** Where the wallpaper lives: per browser, never shared through links. */
export interface WallpaperStore {
  get(): string | undefined;
  set(dataUrl: string | undefined): void;
}

export const WALLPAPER_KEY = "industrial-os.wallpaper";

/** localStorage backed store; every access is guarded because storage can be unavailable. */
export class LocalStorageWallpaperStore implements WallpaperStore {
  constructor(
    private readonly storage:
      | Pick<Storage, "getItem" | "setItem" | "removeItem">
      | undefined = safeLocalStorage(),
  ) {}

  get(): string | undefined {
    try {
      const value = this.storage?.getItem(WALLPAPER_KEY);
      return value && value.startsWith("data:image/") ? value : undefined;
    } catch {
      return undefined;
    }
  }

  set(dataUrl: string | undefined): void {
    try {
      if (dataUrl) this.storage?.setItem(WALLPAPER_KEY, dataUrl);
      else this.storage?.removeItem(WALLPAPER_KEY);
    } catch {
      // Quota exceeded or storage blocked: the wallpaper simply does not persist.
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

export class MemoryWallpaperStore implements WallpaperStore {
  private value: string | undefined;
  get() {
    return this.value;
  }
  set(dataUrl: string | undefined) {
    this.value = dataUrl;
  }
}

export const WallpaperStoreContext = createContext<WallpaperStore>(
  new LocalStorageWallpaperStore(),
);
