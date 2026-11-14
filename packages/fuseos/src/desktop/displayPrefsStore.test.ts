import { WIN98_PALETTE } from '../paint/palette';

import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_ICON_SPACING_X,
  DISPLAY_PREFS_KEY,
  LocalStorageDisplayPrefsStore,
  MAX_ICON_SPACING,
  MIN_ICON_SPACING,
  MemoryDisplayPrefsStore,
  clampIconSpacing,
  parseDisplayPrefs,
} from './displayPrefsStore';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
  };
}

describe(clampIconSpacing.name, () => {
  it('keeps a value already inside the range', () => {
    expect(clampIconSpacing(80)).toBe(80);
  });

  it('clamps below the minimum so icons can never overlap', () => {
    expect(clampIconSpacing(0)).toBe(MIN_ICON_SPACING);
    expect(clampIconSpacing(-50)).toBe(MIN_ICON_SPACING);
  });

  it('clamps above the maximum so icons can never fly off screen', () => {
    expect(clampIconSpacing(9999)).toBe(MAX_ICON_SPACING);
  });

  it('rounds a fractional value', () => {
    expect(clampIconSpacing(80.6)).toBe(81);
  });

  it('falls back to the default for a non-finite value', () => {
    expect(clampIconSpacing(NaN)).toBe(DEFAULT_ICON_SPACING_X);
    expect(clampIconSpacing(Infinity)).toBe(MAX_ICON_SPACING); // Infinity clamps to the max, not the fallback.
  });
});

describe(parseDisplayPrefs.name, () => {
  it('returns the defaults for nothing stored', () => {
    expect(parseDisplayPrefs(undefined)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs(null)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs('')).toEqual(DEFAULT_DISPLAY_PREFS);
  });

  it('returns the defaults for broken or non-object JSON', () => {
    expect(parseDisplayPrefs('not json')).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs('42')).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs('null')).toEqual(DEFAULT_DISPLAY_PREFS);
  });

  it('reads every valid field', () => {
    const raw = JSON.stringify({ backgroundColor: '#800000', iconSpacingX: 100, iconSpacingY: 60, largeFonts: true });
    expect(parseDisplayPrefs(raw)).toEqual({ ...DEFAULT_DISPLAY_PREFS, backgroundColor: '#800000', iconSpacingX: 100, iconSpacingY: 60, largeFonts: true });
  });

  it('clamps stored icon spacing, so a hand edited or corrupted value cannot overlap or fly off screen', () => {
    const raw = JSON.stringify({ iconSpacingX: -10, iconSpacingY: 99999 });
    const prefs = parseDisplayPrefs(raw);
    expect(prefs.iconSpacingX).toBe(MIN_ICON_SPACING);
    expect(prefs.iconSpacingY).toBe(MAX_ICON_SPACING);
  });

  it('falls back to the default colour for anything outside the Windows 98 palette', () => {
    expect(parseDisplayPrefs(JSON.stringify({ backgroundColor: '#123456' })).backgroundColor).toBe(DEFAULT_BACKGROUND_COLOR);
    expect(parseDisplayPrefs(JSON.stringify({ backgroundColor: 'red' })).backgroundColor).toBe(DEFAULT_BACKGROUND_COLOR);
    WIN98_PALETTE.forEach((color) => expect(parseDisplayPrefs(JSON.stringify({ backgroundColor: color })).backgroundColor).toBe(color));
  });

  it('falls back to the default for a non-boolean largeFonts', () => {
    expect(parseDisplayPrefs(JSON.stringify({ largeFonts: 'yes' })).largeFonts).toBe(false);
  });
});

describe(LocalStorageDisplayPrefsStore.name, () => {
  it('stores and reads the preferences as JSON', () => {
    const storage = fakeStorage();
    const store = new LocalStorageDisplayPrefsStore(storage);
    expect(store.get()).toEqual(DEFAULT_DISPLAY_PREFS);
    store.set({ backgroundColor: '#800000', iconSpacingX: 90, iconSpacingY: 90, largeFonts: true });
    expect(storage.setItem).toHaveBeenCalledWith(DISPLAY_PREFS_KEY, JSON.stringify({ backgroundColor: '#800000', iconSpacingX: 90, iconSpacingY: 90, largeFonts: true }));
    expect(store.get()).toEqual({ ...DEFAULT_DISPLAY_PREFS, backgroundColor: '#800000', iconSpacingX: 90, iconSpacingY: 90, largeFonts: true });
  });

  it('survives broken storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = new LocalStorageDisplayPrefsStore(broken);
    expect(store.get()).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(() => store.set(DEFAULT_DISPLAY_PREFS)).not.toThrow();
    expect(new LocalStorageDisplayPrefsStore(undefined).get()).toEqual(DEFAULT_DISPLAY_PREFS);
  });
});

describe(MemoryDisplayPrefsStore.name, () => {
  it('keeps the preferences in memory, defaulting to the classic teal desktop', () => {
    const store = new MemoryDisplayPrefsStore();
    expect(store.get()).toEqual(DEFAULT_DISPLAY_PREFS);
    store.set({ backgroundColor: '#000080', iconSpacingX: 50, iconSpacingY: 50, largeFonts: false });
    expect(store.get()).toEqual({ backgroundColor: '#000080', iconSpacingX: 50, iconSpacingY: 50, largeFonts: false });
  });
});


describe('stored display modes', () => {
  it('restores supported display modes and falls back for corrupt or old preferences', () => {
    expect(parseDisplayPrefs(JSON.stringify({ colorMode: '256-colors', desktopArea: '800x600' }))).toMatchObject({ colorMode: '256-colors', desktopArea: '800x600' });
    expect(parseDisplayPrefs(JSON.stringify({ colorMode: 'bad', desktopArea: '0x0' }))).toMatchObject({ colorMode: 'true-color', desktopArea: 'current' });
    expect(parseDisplayPrefs(JSON.stringify({ largeFonts: true }))).toMatchObject({ colorMode: 'true-color', desktopArea: 'current', largeFonts: true });
  });
});
