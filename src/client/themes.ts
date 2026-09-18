import { safeStorage, type SafeStorage } from "./safe-storage.js";
export type ThemeId = "neon-pixel" | "clean-neon";
export type SpriteName = "rider" | "bomb" | "flame";

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
    /** The whole difference between the two styles: brick boundary wall, dotted trail cores and square caps. Bombs, blasts and pickups always render smooth (#88). */
    pixelated: boolean;
    trailGlow: number;
    wallWidth: number;
  };
  sprites: Record<SpriteName, string>;
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  "neon-pixel": {
    id: "neon-pixel",
    label: "Neon Pixel",
    palette: {
      floorCenter: "#071b39",
      floorEdge: "#020715",
      grid: "rgba(30,132,205,.15)",
      rim: "#17dcff",
      wall: "#593dba",
      blast: "#ff7b16",
      blastCore: "#fff6b0",
      panel: "rgba(5,14,37,.93)",
    },
    rendering: { gridSize: 30, pixelated: true, trailGlow: 2.2, wallWidth: 12 },
    sprites: {
      rider: "/themes/neon-pixel/rider.svg",
      bomb: "/themes/neon-pixel/bomb.svg",
      flame: "/themes/neon-pixel/flame.svg",
    },
  },
  "clean-neon": {
    id: "clean-neon",
    label: "Clean Neon",
    palette: {
      floorCenter: "#0a2647",
      floorEdge: "#020914",
      grid: "rgba(68,177,225,.11)",
      rim: "#00d9ff",
      wall: "#285c9b",
      blast: "#ff6522",
      blastCore: "#ffffff",
      panel: "rgba(5,20,42,.94)",
    },
    rendering: { gridSize: 50, pixelated: false, trailGlow: 3.5, wallWidth: 7 },
    sprites: {
      rider: "/themes/clean-neon/rider.svg",
      bomb: "/themes/clean-neon/bomb.svg",
      flame: "/themes/clean-neon/flame.svg",
    },
  },
};

export const defaultTheme = themes["neon-pixel"];

export function applyThemeProperties(theme: ThemeDefinition): void {
  const style = document.documentElement.style;
  style.setProperty("--cyan", theme.palette.rim);
  style.setProperty("--navy", theme.palette.floorEdge);
  style.setProperty("--panel", theme.palette.panel);
  style.setProperty("--theme-wall", theme.palette.wall);
  document.documentElement.dataset.theme = theme.id;
}

export const THEME_STORAGE_KEY = "fuse-riders-display-theme";
const themeStore = safeStorage(() => localStorage);

/**
 * The visual style this page should render: `?theme=` wins, then the stored choice, then the default.
 * A `?theme=` that names a real style is stored, because entering a room rewrites the URL (`?solo=1`,
 * `?room=CODE`) and would otherwise drop the override on the next call.
 */
export function selectedTheme(
  search: string = location.search,
  store: SafeStorage = themeStore,
): ThemeDefinition {
  // Object.hasOwn (not `id in themes`) so a stored value like "constructor" cannot resolve to a prototype member.
  const requested = new URLSearchParams(search).get("theme");
  if (requested && Object.hasOwn(themes, requested)) {
    store.setItem(THEME_STORAGE_KEY, requested);
    return themes[requested as ThemeId];
  }
  const stored = store.getItem(THEME_STORAGE_KEY);
  return stored && Object.hasOwn(themes, stored)
    ? themes[stored as ThemeId]
    : defaultTheme;
}

export function storeTheme(id: ThemeId): void {
  themeStore.setItem(THEME_STORAGE_KEY, id);
}
