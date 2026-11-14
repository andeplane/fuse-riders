import { MY_COMPUTER } from "../disk/diskPath";
import { isGameId } from "../retro/gameIds";

import type { WindowContent } from "./appState";

/** The query parameter a link uses to open windows on boot: `?open=fuseball,paint`. */
export const OPEN_PARAM = "open";

/** The non-game targets `?open=` understands. */
const APPS: Record<string, WindowContent> = {
  paint: { kind: "paint" },
  winamp: { kind: "winamp" },
  settings: { kind: "controlpanel", applet: "home" },
  about: { kind: "about" },
  fusteam: { kind: "launcher" },
  friends: { kind: "friends" },
  halloffame: { kind: "halloffame" },
  defrag: { kind: "defrag" },
  mycomputer: { kind: "explorer", location: MY_COMPUTER },
  explorer: { kind: "explorer", location: MY_COMPUTER },
};

/** Something that knows which Fuse games exist; the registry in production, a fixture in tests. */
export type GameLookup = { has(id: string): boolean };

/** The ids a page's `?open=` names, in order, deduplicated; empty without the parameter. */
export function parseOpenParam(search: string): string[] {
  const raw = new URLSearchParams(search).get(OPEN_PARAM);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter((id) => id.length > 0),
    ),
  ];
}

/** The window each id opens: a Fuse game, a retro game or an app. Unknown ids are dropped. */
export function deepLinkContents(
  ids: readonly string[],
  games: GameLookup,
): WindowContent[] {
  return ids.flatMap((id): WindowContent[] => {
    if (games.has(id)) return [{ kind: "fusegame", gameId: id }];
    if (isGameId(id)) return [{ kind: "retro", game: id }];
    const app = APPS[id];
    return app ? [app] : [];
  });
}

/** Something that knows where a Fuse game's page is; the registry in production. */
export type GamePageLookup = {
  find(id: string): { id: string } | undefined;
  embedUrl(game: { id: string }): string;
};

/**
 * On a device that opens games in a tab (a phone, a narrow screen, or the user's choice) a link to a game means
 * the game itself, not a desktop it would not fit in: the page the address should be replaced with, when the
 * first id named is a Fuse game. Anything else the link asked for is left behind with the desktop.
 */
export function deepLinkRedirect(
  ids: readonly string[],
  games: GamePageLookup,
  launch: "window" | "tab",
): string | undefined {
  if (launch !== "tab") return undefined;
  const first = ids[0];
  const game = first === undefined ? undefined : games.find(first);
  return game && games.embedUrl(game);
}

/** The same URL without `?open=`, so a reload does not reopen the windows a link asked for once. */
export function withoutOpenParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(OPEN_PARAM);
  return url.href;
}
