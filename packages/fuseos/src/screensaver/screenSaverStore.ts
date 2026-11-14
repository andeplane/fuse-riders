import { createContext } from "react";

import type { JointStyle } from "./pipes/pipesModel";
import { isJointStyle } from "./pipes/pipesModel";

/** "(None)" or the one saver there is. */
export type ScreenSaverKind = "none" | "pipes";
export type PipesPrefs = {
  joints: JointStyle;
  teapots: boolean;
  multiple: boolean;
};
export type ScreenSaverPrefs = {
  saver: ScreenSaverKind;
  /** Idle minutes before the saver starts, 1 to 60. */
  waitMinutes: number;
  pipes: PipesPrefs;
};

export const DEFAULT_PIPES_PREFS: PipesPrefs = {
  joints: "mixed",
  teapots: true,
  multiple: true,
};
export const DEFAULT_SCREEN_SAVER_PREFS: ScreenSaverPrefs = {
  saver: "pipes",
  waitMinutes: 5,
  pipes: DEFAULT_PIPES_PREFS,
};
export const SCREEN_SAVER_KEY = "fuseos.screensaver";
export const MIN_WAIT_MINUTES = 1;
export const MAX_WAIT_MINUTES = 60;

export function isScreenSaverKind(value: unknown): value is ScreenSaverKind {
  return value === "none" || value === "pipes";
}

export function normalizePipesPrefs(prefs: Partial<PipesPrefs>): PipesPrefs {
  return {
    joints: isJointStyle(prefs.joints)
      ? prefs.joints
      : DEFAULT_PIPES_PREFS.joints,
    teapots:
      typeof prefs.teapots === "boolean"
        ? prefs.teapots
        : DEFAULT_PIPES_PREFS.teapots,
    multiple:
      typeof prefs.multiple === "boolean"
        ? prefs.multiple
        : DEFAULT_PIPES_PREFS.multiple,
  };
}

/** A partial preference, `pipes` partial too; anything missing or invalid takes its default. */
export type ScreenSaverPrefsPatch = Partial<Omit<ScreenSaverPrefs, "pipes">> & {
  pipes?: Partial<PipesPrefs>;
};

export function normalizeScreenSaverPrefs(
  prefs: ScreenSaverPrefsPatch,
): ScreenSaverPrefs {
  return {
    saver: isScreenSaverKind(prefs.saver)
      ? prefs.saver
      : DEFAULT_SCREEN_SAVER_PREFS.saver,
    waitMinutes:
      typeof prefs.waitMinutes === "number" &&
      Number.isFinite(prefs.waitMinutes)
        ? Math.min(
            MAX_WAIT_MINUTES,
            Math.max(MIN_WAIT_MINUTES, Math.round(prefs.waitMinutes)),
          )
        : DEFAULT_SCREEN_SAVER_PREFS.waitMinutes,
    pipes: normalizePipesPrefs(prefs.pipes ?? {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScreenSaverPrefs(
  raw: string | null | undefined,
): ScreenSaverPrefs {
  if (!raw) return normalizeScreenSaverPrefs({});
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return normalizeScreenSaverPrefs({});
    return normalizeScreenSaverPrefs({
      saver: isScreenSaverKind(value.saver) ? value.saver : undefined,
      waitMinutes:
        typeof value.waitMinutes === "number" ? value.waitMinutes : undefined,
      pipes: isRecord(value.pipes)
        ? {
            joints: isJointStyle(value.pipes.joints)
              ? value.pipes.joints
              : undefined,
            teapots:
              typeof value.pipes.teapots === "boolean"
                ? value.pipes.teapots
                : undefined,
            multiple:
              typeof value.pipes.multiple === "boolean"
                ? value.pipes.multiple
                : undefined,
          }
        : undefined,
    });
  } catch {
    // Corrupt JSON in storage: the defaults apply, and the next save overwrites it.
    return normalizeScreenSaverPrefs({});
  }
}

export interface ScreenSaverStore {
  get(): ScreenSaverPrefs;
  set(prefs: ScreenSaverPrefs): void;
}

export class LocalStorageScreenSaverStore implements ScreenSaverStore {
  constructor(
    private readonly storage:
      Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage(),
  ) {}
  get(): ScreenSaverPrefs {
    try {
      return parseScreenSaverPrefs(this.storage?.getItem(SCREEN_SAVER_KEY));
    } catch {
      // A blocked storage (private mode, a policy) still leaves the defaults usable.
      return normalizeScreenSaverPrefs({});
    }
  }
  set(prefs: ScreenSaverPrefs): void {
    try {
      this.storage?.setItem(
        SCREEN_SAVER_KEY,
        JSON.stringify(normalizeScreenSaverPrefs(prefs)),
      );
    } catch {
      // Blocked or full storage leaves the current preference usable for this session.
    }
  }
}

export class MemoryScreenSaverStore implements ScreenSaverStore {
  private prefs: ScreenSaverPrefs;
  constructor(initial: ScreenSaverPrefsPatch = {}) {
    this.prefs = normalizeScreenSaverPrefs(initial);
  }
  get(): ScreenSaverPrefs {
    return normalizeScreenSaverPrefs(this.prefs);
  }
  set(prefs: ScreenSaverPrefs): void {
    this.prefs = normalizeScreenSaverPrefs(prefs);
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // Touching `localStorage` itself throws when a browser policy blocks it.
    return undefined;
  }
}

export const ScreenSaverStoreContext = createContext<ScreenSaverStore>(
  new LocalStorageScreenSaverStore(),
);
