import { colorFilterTables, colorModeByLabel, desktopAreaByLabel, displayColorFilter, displayGeometry, isColorMode, isDesktopArea } from './displayModes';

describe('display modes', () => {
  it('recognizes only supported persisted modes and matching UI labels', () => {
    expect(isColorMode('256-colors')).toBe(true);
    expect(isColorMode('infinite')).toBe(false);
    expect(isDesktopArea('800x600')).toBe(true);
    expect(isDesktopArea('9000x9000')).toBe(false);
    expect(colorModeByLabel('256 colors (8 bit)')).toBe('256-colors');
    expect(colorModeByLabel('high color (16 bit)')).toBe('high-color');
    expect(colorModeByLabel('true color (24 bit)')).toBe('true-color');
    expect(colorModeByLabel('wrong')).toBeUndefined();
    expect(displayColorFilter('true-color')).toBeUndefined();
    expect(displayColorFilter('256-colors')).toBe('url(#display-256-colors)');
    expect(desktopAreaByLabel('800 by 600 pixels')).toBe('800x600');
    expect(desktopAreaByLabel('current window')).toBe('current');
    expect(desktopAreaByLabel('wrong')).toBeUndefined();
  });

  it('quantizes to exactly RGB332 256 colors and RGB565 High Color', () => {
    const low = colorFilterTables('256-colors');
    expect(low.red.split(' ')).toHaveLength(8);
    expect(low.green.split(' ')).toHaveLength(8);
    expect(low.blue.split(' ')).toHaveLength(4);
    const high = colorFilterTables('high-color');
    expect(high.red.split(' ')).toHaveLength(32);
    expect(high.green.split(' ')).toHaveLength(64);
    expect(high.blue.split(' ')).toHaveLength(32);
    expect(low.red.split(' ')[0]).toBe('0');
    expect(low.red.split(' ')[7]).toBe('1');
  });

  it('keeps native mode fluid and scales retro desktops down without changing logical pixels', () => {
    expect(displayGeometry('current', { width: 1200, height: 700 })).toEqual({ viewport: { width: 1200, height: 700 }, scale: 1 });
    expect(displayGeometry('800x600', { width: 1200, height: 700 })).toEqual({ viewport: { width: 800, height: 600 }, scale: 1 });
    expect(displayGeometry('1024x768', { width: 512, height: 384 })).toEqual({ viewport: { width: 1024, height: 768 }, scale: 0.5 });
    expect(displayGeometry('640x480', { width: 320, height: 400 }).scale).toBe(0.5);
  });

  it('bounds invalid host dimensions without invalid transforms', () => {
    const result = displayGeometry('800x600', { width: NaN, height: Infinity });
    expect(Number.isFinite(result.scale)).toBe(true);
    expect(result.scale).toBeGreaterThan(0);
    expect(displayGeometry('current', { width: 0, height: -1 }).viewport).toEqual({ width: 1, height: 1 });
  });
});
