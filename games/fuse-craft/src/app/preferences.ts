import type { PreferencesStore, PresentationPreferences } from "./contracts.js";

const key = "fuse-craft-presentation-v1";
/** The key from before the game was renamed from its working name; read so a returning player keeps settings. */
const legacyKey = "neural-defence-presentation-v1";
const defaults: PresentationPreferences = {
  mute: true,
  volume: 0.5,
  reducedMotion: false,
  edgeScroll: true,
};

export function createPreferencesStore(
  storage: Pick<Storage, "getItem" | "setItem">,
): PreferencesStore {
  return {
    read() {
      try {
        const raw = storage.getItem(key) ?? storage.getItem(legacyKey);
        if (!raw) return { ...defaults };
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null) return { ...defaults };
        const parsed = value as Partial<PresentationPreferences>;
        return {
          mute: typeof parsed.mute === "boolean" ? parsed.mute : defaults.mute,
          volume:
            typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
              ? Math.max(0, Math.min(1, parsed.volume))
              : defaults.volume,
          reducedMotion:
            typeof parsed.reducedMotion === "boolean"
              ? parsed.reducedMotion
              : defaults.reducedMotion,
          edgeScroll:
            typeof parsed.edgeScroll === "boolean"
              ? parsed.edgeScroll
              : defaults.edgeScroll,
        };
      } catch {
        return { ...defaults };
      }
    },
    write(value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        /* Storage can be unavailable. */
      }
    },
  };
}
