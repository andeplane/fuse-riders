import type { PortalGame } from "fuse-ui/portal";
import { createContext } from "react";

import type { ImageIcon } from "../ui/icons";

/** A Fuse game as the desktop knows it: the portal entry plus where its page is served. */
export type FuseGame = PortalGame;

/** Every Fuse game and how to reach it, built once at boot from the portal list (`__FUSE_PORTAL_GAMES__`). */
export interface FuseGameRegistry {
  readonly games: readonly FuseGame[];
  find(id: string): FuseGame | undefined;
  has(id: string): boolean;
  /** The URL a game window embeds: `<base><id>/`, with `?mute` when the OS itself was opened muted. */
  embedUrl(game: FuseGame): string;
  /** The gameplay capture a window shows while the game loads, when the game ships one. */
  screenshotUrl(game: FuseGame): string | undefined;
  /** The game's desktop icon at both sizes, when the build found one; the caller falls back to the tile. */
  icon(game: FuseGame): ImageIcon | undefined;
}

export type FuseGameRegistryOptions = {
  games: readonly PortalGame[];
  /** The site base, `import.meta.env.BASE_URL` ("/", "/fuse-riders/" or "./"). */
  base: string;
  /** The OS page was opened with `?mute`; every game it embeds inherits it. */
  muted: boolean;
};

export function createFuseGameRegistry(
  options: FuseGameRegistryOptions,
): FuseGameRegistry {
  const games = [...options.games];
  const byId = new Map(games.map((game) => [game.id, game]));
  // The root page sits beside every game page, so a relative base resolves against the document.
  const base = options.base === "" ? "./" : options.base;
  const query = options.muted ? "?mute" : "";
  return {
    games,
    find: (id) => byId.get(id),
    has: (id) => byId.has(id),
    embedUrl: (game) => `${base}${game.path}${query}`,
    screenshotUrl: (game) =>
      game.screenshot ? `${base}${game.screenshot}` : undefined,
    icon: (game) =>
      game.icon
        ? {
            kind: "image",
            src: `${base}${game.icon}`,
            smallSrc: `${base}${game.icon.replace(/\.png$/, "-16.png")}`,
          }
        : undefined,
  };
}

export const EMPTY_FUSE_GAMES = createFuseGameRegistry({
  games: [],
  base: "/",
  muted: false,
});

export const FuseGamesContext =
  createContext<FuseGameRegistry>(EMPTY_FUSE_GAMES);
