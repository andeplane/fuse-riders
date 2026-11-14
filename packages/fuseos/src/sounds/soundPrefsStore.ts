import { createContext } from "react";

import type { SystemSoundEvent } from "./soundEvents";
import { isSystemSoundEvent } from "./soundEvents";

/** Control Panel > Sounds: the master switch and one toggle per event, persisted per browser. */
export type SoundPrefs = {
  /** "Play system sounds"; off silences everything. */
  master: boolean;
  /** Absent means on. */
  events: Partial<Record<SystemSoundEvent, boolean>>;
};

export const DEFAULT_SOUND_PREFS: SoundPrefs = { master: true, events: {} };

export interface SoundPrefsStore {
  get(): SoundPrefs;
  set(prefs: SoundPrefs): void;
}

export const SOUND_PREFS_KEY = "fuseos.sounds";

export function parseSoundPrefs(raw: string | null | undefined): SoundPrefs {
  if (!raw) return DEFAULT_SOUND_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_SOUND_PREFS;
    const record: Record<string, unknown> = { ...parsed };
    const events: Partial<Record<SystemSoundEvent, boolean>> = {};
    if (typeof record.events === "object" && record.events !== null) {
      for (const [key, value] of Object.entries(record.events))
        if (isSystemSoundEvent(key) && typeof value === "boolean")
          events[key] = value;
    }
    return {
      master: typeof record.master === "boolean" ? record.master : true,
      events,
    };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

/** Whether `event` sounds under `prefs` (the master switch and the event's own toggle). */
export function soundEnabled(
  prefs: SoundPrefs,
  event: SystemSoundEvent,
): boolean {
  return prefs.master && prefs.events[event] !== false;
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
export class LocalStorageSoundPrefsStore implements SoundPrefsStore {
  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {}

  get(): SoundPrefs {
    try {
      return parseSoundPrefs(this.storage?.getItem(SOUND_PREFS_KEY));
    } catch {
      return DEFAULT_SOUND_PREFS;
    }
  }

  set(prefs: SoundPrefs): void {
    try {
      this.storage?.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked or full: the choice simply is not remembered.
    }
  }
}

export class MemorySoundPrefsStore implements SoundPrefsStore {
  constructor(private prefs: SoundPrefs = DEFAULT_SOUND_PREFS) {}
  get(): SoundPrefs {
    return this.prefs;
  }
  set(prefs: SoundPrefs): void {
    this.prefs = prefs;
  }
}

export const SoundPrefsStoreContext = createContext<SoundPrefsStore>(
  new LocalStorageSoundPrefsStore(),
);
