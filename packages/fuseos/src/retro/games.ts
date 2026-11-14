import type { IconName } from "../ui/icons";

import type { GameId } from "./gameIds";
import { GAME_IDS } from "./gameIds";

/**
 * How a game runs: `jsdos` bundles boot in the self-hosted js-dos player page,
 * `iframe` games are vendored web pages, `native` games are React components.
 */
export type GameRuntime = "jsdos" | "iframe" | "native";

export type GameInfo = {
  id: GameId;
  name: string;
  icon: IconName;
  runtime: GameRuntime;
  /** Page under public/, relative to the app root, for `iframe` games; bundle name under public/games for `jsdos` games. */
  source: string;
  /** How to play, in one line. */
  controls: string;
  /** Licence or distribution terms, shown in the Retro Games folder's Details view and credited in docs/fuseos/retro-games.md. */
  licence: string;
  /** Window size the game opens at (clamped to the desktop). */
  windowSize: { width: number; height: number };
};

/** A 640x400 DOS screen scaled 1.25x plus the window chrome. */
// Big enough that the 320x200 DOS picture is scaled up threefold; games are meant to fill the screen.
const DOS_WINDOW = { width: 1040, height: 700 };

export const GAMES: Record<GameId, GameInfo> = {
  doom: {
    id: "doom",
    name: "DOOM",
    icon: "doom",
    runtime: "jsdos",
    source: "doom",
    controls:
      "Arrows move, Ctrl fires, Space opens doors, Alt strafes, Esc for the menu.",
    licence:
      "Shareware episode 1 (v1.9), id Software; freely distributable without charge.",
    windowSize: DOS_WINDOW,
  },
  wolf3d: {
    id: "wolf3d",
    name: "Wolfenstein 3D",
    icon: "wolf3d",
    runtime: "jsdos",
    source: "wolf3d",
    controls:
      "Arrows move, Ctrl fires, Space opens doors, Alt strafes, Esc for the menu.",
    licence:
      "Shareware episode 1 (v1.4), id Software / Apogee; freely distributable without charge.",
    windowSize: DOS_WINDOW,
  },
  keen1: {
    id: "keen1",
    name: "Commander Keen 1: Marooned on Mars",
    icon: "keen",
    runtime: "jsdos",
    source: "keen1",
    controls:
      "Arrows move, Ctrl jumps, Alt pogo sticks, Space status, Esc for the menu.",
    licence:
      "Shareware episode 1, id Software / Apogee; freely distributable without charge.",
    windowSize: DOS_WINDOW,
  },
  duke3d: {
    id: "duke3d",
    name: "Duke Nukem 3D",
    icon: "duke",
    runtime: "jsdos",
    source: "duke3d",
    controls:
      "Arrows move, Ctrl fires, Space opens doors, Alt strafes, A jumps, Z crouches, Esc for the menu.",
    licence:
      "Shareware v1.3d episode 1, 3D Realms; freely distributable without charge.",
    windowSize: DOS_WINDOW,
  },
  minesweeper: {
    id: "minesweeper",
    name: "Minesweeper",
    icon: "minesweeper",
    runtime: "native",
    source: "",
    controls:
      "Left click reveals, right click flags, the smiley starts over. Game menu picks the difficulty.",
    licence: "Written for FuseOS.",
    windowSize: { width: 240, height: 280 },
  },
  skifree: {
    id: "skifree",
    name: "SkiFree",
    icon: "skifree",
    runtime: "iframe",
    source: "fuseos/retro/skifree/index.html",
    controls: "Mouse or WASD steer, F boosts, Space restarts. Beware the yeti.",
    licence: "skifree.js by Dan Hough, MIT.",
    windowSize: { width: 800, height: 600 },
  },
  micropolis: {
    id: "micropolis",
    name: "Micropolis",
    icon: "micropolis",
    runtime: "iframe",
    source: "fuseos/retro/micropolis/index.html",
    controls:
      "Pick a tool on the right and click the map; the buttons on the left open the budget, evaluation and disasters.",
    // micropolisJS refuses to run under 583px of height and folds its side panels under 850px of width.
    licence:
      "micropolisJS by Graeme McCutcheon, GPL-3.0; Micropolis is a registered trademark of Micropolis GmbH, used under the Micropolis Public Name License.",
    windowSize: { width: 1120, height: 720 },
  },
  solitaire: {
    id: "solitaire",
    name: "Solitaire",
    icon: "solitaire",
    runtime: "native",
    source: "",
    controls:
      "Click the deck to draw, drag cards between columns, double click sends a card to its foundation. Game menu deals, undoes and sets the deck and options.",
    licence:
      "Written for FuseOS; card faces from Vector Playing Cards by Byron Knoll, public domain.",
    windowSize: { width: 640, height: 480 },
  },
};

export const GAME_LIST: GameInfo[] = GAME_IDS.map((id) => GAMES[id]);

/** The DOS programs (js-dos): what the DOS Games folder on the desktop is named for. */
export const DOS_GAMES: GameInfo[] = GAME_LIST.filter(
  (game) => game.runtime === "jsdos",
);

/** The rest, the games Windows itself came with or ran: a group of their own at the bottom of the folder. */
export const WINDOWS_GAMES: GameInfo[] = GAME_LIST.filter(
  (game) => game.runtime !== "jsdos",
);

/** Page to show in the game window, relative to the app root. Native games have none. */
export function gamePage(game: GameInfo): string | undefined {
  switch (game.runtime) {
    case "jsdos":
      return `fuseos/jsdos/player.html?bundle=${encodeURIComponent(game.source)}`;
    case "iframe":
      return game.source;
    case "native":
      return undefined;
  }
}

/** Finds a game by id or name, case insensitive; partial names match when unique. */
export function findGame(idOrName: string): GameInfo | undefined {
  const wanted = idOrName.trim().toLowerCase();
  const exact = GAME_LIST.find(
    (game) => game.id === wanted || game.name.toLowerCase() === wanted,
  );
  if (exact) return exact;
  const partial = GAME_LIST.filter((game) =>
    game.name.toLowerCase().includes(wanted),
  );
  return partial.length === 1 ? partial[0] : undefined;
}
