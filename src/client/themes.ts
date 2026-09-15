import { assetUrl } from './asset-url.js';
import { safeStorage } from './safe-storage.js';
export type ThemeId = 'neon-pixel' | 'clean-neon';
export type SpriteName = 'rider' | 'bomb' | 'flame';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  palette: {
    floorCenter: string;
    floorEdge: string;
    grid: string;
    rim: string;
    wall: string;
    blast: string;
    blastCore: string;
    panel: string;
  };
  rendering: {
    gridSize: number;
    /** Canvas trail sparkle pixels and the rider SVG fallback only; bombs, blasts and pickups always render smooth (#88). */
    pixelated: boolean;
    trailCap: CanvasLineCap;
    trailGlow: number;
    wallDash: readonly number[];
    wallWidth: number;
  };
  sprites: Record<SpriteName, string>;
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  'neon-pixel': {
    id: 'neon-pixel',
    label: 'Neon Pixel',
    palette: {
      floorCenter: '#071b39', floorEdge: '#020715', grid: 'rgba(30,132,205,.15)',
      rim: '#17dcff', wall: '#593dba', blast: '#ff7b16', blastCore: '#fff6b0', panel: 'rgba(5,14,37,.93)',
    },
    rendering: { gridSize: 30, pixelated: true, trailCap: 'square', trailGlow: 2.2, wallDash: [28, 5], wallWidth: 12 },
    sprites: { rider: '/themes/neon-pixel/rider.svg', bomb: '/themes/neon-pixel/bomb.svg', flame: '/themes/neon-pixel/flame.svg' },
  },
  'clean-neon': {
    id: 'clean-neon',
    label: 'Clean Neon',
    palette: {
      floorCenter: '#0a2647', floorEdge: '#020914', grid: 'rgba(68,177,225,.11)',
      rim: '#00d9ff', wall: '#285c9b', blast: '#ff6522', blastCore: '#ffffff', panel: 'rgba(5,20,42,.94)',
    },
    rendering: { gridSize: 50, pixelated: false, trailCap: 'round', trailGlow: 3.5, wallDash: [], wallWidth: 7 },
    sprites: { rider: '/themes/clean-neon/rider.svg', bomb: '/themes/clean-neon/bomb.svg', flame: '/themes/clean-neon/flame.svg' },
  },
};

export const defaultTheme = themes['neon-pixel'];

export type ThemeSprites = Partial<Record<SpriteName, HTMLImageElement>>;

export async function loadThemeSprites(theme: ThemeDefinition): Promise<ThemeSprites> {
  const entries = await Promise.all((Object.entries(theme.sprites) as Array<[SpriteName, string]>).map(async ([name, source]) => {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error(`Unable to load ${source}`)), { once: true });
      image.src = assetUrl(source);
    });
    return [name, image] as const;
  }).map((promise) => promise.catch(() => undefined)));
  return Object.fromEntries(entries.filter((entry): entry is readonly [SpriteName, HTMLImageElement] => entry !== undefined));
}

export function applyThemeProperties(theme: ThemeDefinition): void {
  const style = document.documentElement.style;
  style.setProperty('--cyan', theme.palette.rim);
  style.setProperty('--navy', theme.palette.floorEdge);
  style.setProperty('--panel', theme.palette.panel);
  style.setProperty('--theme-wall', theme.palette.wall);
  document.documentElement.dataset.theme = theme.id;
}

export const THEME_STORAGE_KEY = 'fuse-riders-display-theme';
const themeStore = safeStorage(() => localStorage);

/** The visual style this page should render: `?theme=` wins, then the stored choice, then the default. */
export function selectedTheme(): ThemeDefinition {
  const id = new URLSearchParams(location.search).get('theme') ?? themeStore.getItem(THEME_STORAGE_KEY);
  // Object.hasOwn (not `id in themes`) so a stored value like "constructor" cannot resolve to a prototype member.
  return id && Object.hasOwn(themes, id) ? themes[id as ThemeId] : defaultTheme;
}

export function storeTheme(id: ThemeId): void {
  themeStore.setItem(THEME_STORAGE_KEY, id);
}
