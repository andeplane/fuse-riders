import { createContext } from "react";

import { WIN98_PALETTE } from "../paint/palette";

import type { ColorMode, DesktopArea } from "./displayModes";
import { isColorMode, isDesktopArea } from "./displayModes";

/**
 * Per browser desktop display preferences: the solid background colour (an alternative to
 * the wallpaper, see wallpaperStore.ts), the desktop icon grid spacing and whether the whole
 * chrome uses the Windows 98 "Large fonts" scale. Never shared through links, same as the
 * wallpaper (AGENTS.md §10.4).
 */
export type DisplayPrefs = {
  /** One of the Windows 98 palette colours (paint/palette.ts), which already includes the classic teal. */
  backgroundColor: string;
  iconSpacingX: number;
  iconSpacingY: number;
  largeFonts: boolean;
  colorMode?: ColorMode;
  desktopArea?: DesktopArea;
};

/** The classic Windows 98 desktop teal; also the palette's own "teal" swatch, so no second constant is needed there. */
export const DEFAULT_BACKGROUND_COLOR = "#008080";

/** Windows 98 Display Properties > Appearance's defaults for "Icon Spacing (Horizontal/Vertical)". */
export const DEFAULT_ICON_SPACING_X = 75;
export const DEFAULT_ICON_SPACING_Y = 75;

/** Enough room around a 32px icon and its label that two never overlap, however small the value picked. */
export const MIN_ICON_SPACING = 40;
/** Wide enough to look intentional, never so wide the grid runs off a small screen. */
export const MAX_ICON_SPACING = 160;

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  iconSpacingX: DEFAULT_ICON_SPACING_X,
  iconSpacingY: DEFAULT_ICON_SPACING_Y,
  largeFonts: false,
  colorMode: "true-color",
  desktopArea: "current",
};

/** Clamps a desktop icon spacing to a range where icons can never overlap or fly off screen; NaN falls back to the horizontal default before clamping. */
export function clampIconSpacing(value: number): number {
  const numeric = Number.isNaN(value) ? DEFAULT_ICON_SPACING_X : value;
  return Math.round(
    Math.min(MAX_ICON_SPACING, Math.max(MIN_ICON_SPACING, numeric)),
  );
}

function isPaletteColor(value: unknown): value is string {
  return typeof value === "string" && WIN98_PALETTE.includes(value);
}

export function parseDisplayPrefs(
  raw: string | null | undefined,
): DisplayPrefs {
  if (!raw) return DEFAULT_DISPLAY_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_DISPLAY_PREFS;
    const record: Record<string, unknown> = { ...parsed };
    return {
      backgroundColor: isPaletteColor(record.backgroundColor)
        ? record.backgroundColor
        : DEFAULT_DISPLAY_PREFS.backgroundColor,
      iconSpacingX:
        typeof record.iconSpacingX === "number"
          ? clampIconSpacing(record.iconSpacingX)
          : DEFAULT_DISPLAY_PREFS.iconSpacingX,
      iconSpacingY:
        typeof record.iconSpacingY === "number"
          ? clampIconSpacing(record.iconSpacingY)
          : DEFAULT_DISPLAY_PREFS.iconSpacingY,
      colorMode: isColorMode(record.colorMode)
        ? record.colorMode
        : "true-color",
      desktopArea: isDesktopArea(record.desktopArea)
        ? record.desktopArea
        : "current",
      largeFonts:
        typeof record.largeFonts === "boolean"
          ? record.largeFonts
          : DEFAULT_DISPLAY_PREFS.largeFonts,
    };
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

export interface DisplayPrefsStore {
  get(): DisplayPrefs;
  set(prefs: DisplayPrefs): void;
}

export const DISPLAY_PREFS_KEY = "fuseos.display";

/** localStorage backed store; every access is guarded because storage can be unavailable. */
export class LocalStorageDisplayPrefsStore implements DisplayPrefsStore {
  constructor(
    private readonly storage:
      Pick<Storage, "getItem" | "setItem"> | undefined = safeLocalStorage(),
  ) {}

  get(): DisplayPrefs {
    try {
      return parseDisplayPrefs(this.storage?.getItem(DISPLAY_PREFS_KEY));
    } catch {
      return DEFAULT_DISPLAY_PREFS;
    }
  }

  set(prefs: DisplayPrefs): void {
    try {
      this.storage?.setItem(DISPLAY_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Quota exceeded or storage blocked: the preferences simply do not persist.
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

export class MemoryDisplayPrefsStore implements DisplayPrefsStore {
  private prefs: DisplayPrefs = DEFAULT_DISPLAY_PREFS;
  get(): DisplayPrefs {
    return this.prefs;
  }
  set(prefs: DisplayPrefs): void {
    this.prefs = prefs;
  }
}

export const DisplayPrefsStoreContext = createContext<DisplayPrefsStore>(
  new LocalStorageDisplayPrefsStore(),
);
