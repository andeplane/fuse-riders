import { legendSrc } from './legend-src.js';
import type { PowerupGuideEntry } from './powerup-guide.js';
import type { ThemeId } from './themes.js';

export interface PowerupGuideOptions {
  className: string;
  /** Sets icons immediately; omit when the caller applies its saved theme via setTheme(). */
  themeId?: ThemeId;
  /** Accessible list name, for placements without a visible heading. */
  label?: string;
  /** Shown beside pickups that only spawn when enabled in room settings. */
  offByDefaultNote?: string;
}

export interface PowerupGuideView {
  element: HTMLUListElement;
  /** The single place that sets every icon src, so theme switches reach every entry. */
  setTheme(id: ThemeId): void;
}

export function createPowerupGuide(entries: readonly PowerupGuideEntry[], options: PowerupGuideOptions): PowerupGuideView {
  const element = document.createElement('ul');
  element.className = options.className;
  if (options.label) element.setAttribute('aria-label', options.label);
  const icons = entries.map(entry => {
    const item = document.createElement('li'), image = document.createElement('img'), name = document.createElement('b');
    image.alt = ''; image.width = 24; image.height = 24; image.decoding = 'async';
    name.textContent = entry.name;
    item.append(image, name, document.createTextNode(` ${entry.description}`));
    if (!entry.spawnsByDefault && options.offByDefaultNote) item.append(' ', Object.assign(document.createElement('small'), { textContent: options.offByDefaultNote }));
    element.append(item);
    return { image, type: entry.type };
  });
  const setTheme = (id: ThemeId): void => { for (const { image, type } of icons) image.src = legendSrc(id, `pickup-${type}`); };
  if (options.themeId) setTheme(options.themeId);
  return { element, setTheme };
}
