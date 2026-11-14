import { createContext } from "react";

import type { ColorSchemeId } from "./colorSchemes";
import { DEFAULT_COLOR_SCHEME, isColorSchemeId } from "./colorSchemes";

/** The CRT monitor overlay: nothing, scanlines only, or the whole tube (scanlines, vignette, glow, flicker). */
export type CrtMode = "off" | "scanlines" | "full";

export const CRT_MODES: readonly { value: CrtMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "scanlines", label: "Scanlines" },
  { value: "full", label: "Full (scanlines, vignette, glow, flicker)" },
];

/**
 * Display Properties, Appearance and Effects: per browser, like the other display preferences.
 * The colour palette and the screen resolution live in `desktop/displayPrefsStore` (they predate
 * this file); this one holds what the effects tabs add on top.
 */
export type DisplayEffects = {
  crt: CrtMode;
  /** Bends the whole desktop like a tube, through an SVG displacement map; only with `crt: "full"`. */
  curvature: boolean;
  scheme: ColorSchemeId;
};

export const DEFAULT_DISPLAY_EFFECTS: DisplayEffects = {
  crt: "off",
  curvature: false,
  scheme: DEFAULT_COLOR_SCHEME,
};

export function isCrtMode(value: unknown): value is CrtMode {
  return CRT_MODES.some((mode) => mode.value === value);
}

export function parseDisplayEffects(
  raw: string | null | undefined,
): DisplayEffects {
  if (!raw) return DEFAULT_DISPLAY_EFFECTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_DISPLAY_EFFECTS;
    const record: Record<string, unknown> = { ...parsed };
    return {
      crt: isCrtMode(record.crt) ? record.crt : DEFAULT_DISPLAY_EFFECTS.crt,
      curvature:
        typeof record.curvature === "boolean"
          ? record.curvature
          : DEFAULT_DISPLAY_EFFECTS.curvature,
      scheme: isColorSchemeId(record.scheme)
        ? record.scheme
        : DEFAULT_DISPLAY_EFFECTS.scheme,
    };
  } catch {
    return DEFAULT_DISPLAY_EFFECTS;
  }
}

export interface DisplayEffectsStore {
  get(): DisplayEffects;
  set(effects: DisplayEffects): void;
}

export const DISPLAY_EFFECTS_KEY = "fuseos.display-effects";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** localStorage backed; every access is guarded because storage can be unavailable. */
export class LocalStorageDisplayEffectsStore implements DisplayEffectsStore {
  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {}

  get(): DisplayEffects {
    try {
      return parseDisplayEffects(this.storage?.getItem(DISPLAY_EFFECTS_KEY));
    } catch {
      return DEFAULT_DISPLAY_EFFECTS;
    }
  }

  set(effects: DisplayEffects): void {
    try {
      this.storage?.setItem(DISPLAY_EFFECTS_KEY, JSON.stringify(effects));
    } catch {
      // Storage blocked or full: the effects simply are not remembered.
    }
  }
}

export class MemoryDisplayEffectsStore implements DisplayEffectsStore {
  constructor(private effects: DisplayEffects = DEFAULT_DISPLAY_EFFECTS) {}
  get(): DisplayEffects {
    return this.effects;
  }
  set(effects: DisplayEffects): void {
    this.effects = effects;
  }
}

export const DisplayEffectsStoreContext = createContext<DisplayEffectsStore>(
  new LocalStorageDisplayEffectsStore(),
);
