import { APPLETS, appletFor } from './applets';

describe('APPLETS', () => {
  it('has a unique applet key, a non-empty label, description and icon for every entry', () => {
    const keys = APPLETS.map((entry) => entry.applet);
    expect(new Set(keys).size).toBe(keys.length);
    APPLETS.forEach((entry) => {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.icon.length).toBeGreaterThan(0);
      expect(entry.Component).toBeTypeOf('function');
    });
  });

  it('lists Display, Games, System, Assistant and Keyboard, each with its own icon', () => {
    expect(APPLETS.map((entry) => entry.applet)).toEqual(['display', 'games', 'system', 'assistant', 'keyboard']);
    // Two applets sharing an icon would be indistinguishable in the Home grid.
    const icons = APPLETS.map((entry) => entry.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe(appletFor.name, () => {
  it('finds an applet by its tab label, case insensitively', () => {
    expect(appletFor('Display')).toBe('display');
    expect(appletFor('system')).toBe('system');
    expect(appletFor('  Games ')).toBe('games');
    expect(appletFor('ASSISTANT')).toBe('assistant');
    expect(appletFor('keyboard')).toBe('keyboard');
  });

  it('maps "Control Panel" and "Home" to the home grid', () => {
    expect(appletFor('Control Panel')).toBe('home');
    expect(appletFor('home')).toBe('home');
  });

  it('returns undefined for a label that names no applet', () => {
    expect(appletFor('Transformations')).toBeUndefined();
    expect(appletFor('')).toBeUndefined();
  });
});
