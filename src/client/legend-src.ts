import { assetUrl } from "./asset-url.js";
import type { ThemeId } from "./themes.js";

/** Resolves a pickup legend icon path through assetUrl() so it works under a GitHub Pages base path. */
export function legendSrc(themeId: ThemeId, name: string): string {
  return assetUrl(`/themes/${themeId}/${name}.svg`);
}
