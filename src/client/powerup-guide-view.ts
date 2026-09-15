import { legendSrc } from './legend-src.js';
import type { PowerupGuideEntry } from './powerup-guide.js';
import type { ThemeId } from './themes.js';

export interface PowerupGuideView {
  element: HTMLUListElement;
  /** The single place that sets every icon src, so theme switches reach every entry. */
  setTheme(id: ThemeId): void;
}

export function createPowerupGuide(entries: readonly PowerupGuideEntry[], className: string, themeId: ThemeId, optionalNote?: string): PowerupGuideView {
  const element = document.createElement('ul');
  element.className = className;
  element.setAttribute('aria-label', 'Power-ups');
  const images = entries.map(entry => {
    const item = document.createElement('li'), image = document.createElement('img'), name = document.createElement('b');
    image.alt = ''; image.width = 24; image.height = 24; image.decoding = 'async';
    name.textContent = entry.name;
    const note = !entry.spawnsByDefault && optionalNote ? ` · ${optionalNote}` : '';
    item.append(image, name, document.createTextNode(` ${entry.description}${note}`));
    element.append(item);
    return image;
  });
  const setTheme = (id: ThemeId): void => { images.forEach((image, index) => { image.src = legendSrc(id, `pickup-${entries[index]!.type}`); }); };
  setTheme(themeId);
  return { element, setTheme };
}
