import { safeStorage, type SafeStorage } from "./safe-storage.js";
import {
  defaultTheme,
  themes,
  type ThemeDefinition,
  type ThemeId,
} from "../render/themes.js";

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
