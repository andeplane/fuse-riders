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
  friends: { kind: "friends" },
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

/** The same URL without `?open=`, so a reload does not reopen the windows a link asked for once. */
export function withoutOpenParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(OPEN_PARAM);
  return url.href;
}
