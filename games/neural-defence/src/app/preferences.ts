import type { PreferencesStore, PresentationPreferences } from './contracts.js';

const key = 'neural-defence-presentation-v1';
const defaults: PresentationPreferences = { mute: true, volume: 0.5, reducedMotion: false };

export function createPreferencesStore(storage: Pick<Storage, 'getItem' | 'setItem'>): PreferencesStore {
  return {
    read() {
      try {
        const raw = storage.getItem(key);
        if (!raw) return { ...defaults };
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null) return { ...defaults };
        const parsed = value as Partial<PresentationPreferences>;
        return {
          mute: typeof parsed.mute === 'boolean' ? parsed.mute : defaults.mute,
          volume: typeof parsed.volume === 'number' && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(1, parsed.volume)) : defaults.volume,
          reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : defaults.reducedMotion,
        };
      } catch { return { ...defaults }; }
    },
    write(value) {
      try { storage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be unavailable. */ }
    },
  };
}
