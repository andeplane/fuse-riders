import { DRIVE_A, DRIVE_C, MY_COMPUTER, parseAddress } from "../disk/diskPath";
import { SYSTEM32_LOCATION, WINDOWS_LOCATION } from "../disk/diskEntries";
import { isGameId } from "../retro/gameIds";
import type { WindowContent } from "../state/appState";
import type { GameLookup } from "../state/deepLink";
import { deepLinkApp } from "../state/deepLink";

/** What a line typed into Start > Run... asks for. */
export type RunTarget =
  /** A program or folder on this desktop. */
  | { type: "open"; content: WindowContent }
  /** A Fuse game, started the way the Games applet says (a window here or a browser tab). */
  | { type: "fusegame"; gameId: string }
  /** `bsod`: the Blue Screen of Death. */
  | { type: "bsod" }
  /** An http(s) address: a browser tab. */
  | { type: "url"; url: string }
  /** Nothing typed. */
  | { type: "empty" }
  | { type: "notFound"; text: string };

/**
 * Names people type from memory, mapped to the ids `?open=` and the desktop use. A program that is added
 * to `state/deepLink.ts` runs by its id without an entry here.
 */
export const RUN_ALIASES: Readonly<Record<string, string>> = {
  "notepad++": "notepad",
  notepadpp: "notepad",
  mspaint: "paint",
  pbrush: "paint",
  steam: "fusteam",
  launcher: "fusteam",
  taskmgr: "taskmanager",
  "task manager": "taskmanager",
  control: "settings",
  "control panel": "settings",
  controlpanel: "settings",
  "my computer": "explorer",
  mycomputer: "explorer",
  winfile: "explorer",
  recycle: "recyclebin",
  "recycle bin": "recyclebin",
  messenger: "friends",
  icq: "friends",
  msn: "friends",
  neighborhood: "network",
  "network neighborhood": "network",
  leaderboard: "halloffame",
  "hall of fame": "halloffame",
  "dos games": "dosgames",
  dos: "dosgames",
  games: "dosgames",
  winmine: "minesweeper",
  sol: "solitaire",
  wolf: "wolf3d",
  wolfenstein: "wolf3d",
  keen: "keen1",
  duke: "duke3d",
  rasphone: "dialup",
  "dial-up": "dialup",
};

export const RUN_NOT_FOUND_TITLE = "Run";

export function runNotFoundMessage(text: string): string {
  return `Cannot find the file '${text}' (or one of its components). Make sure the path and filename are correct and that all required libraries are available.`;
}

/** The folders Run opens by address: the drives and the fake Windows folders, which need no listing to exist. */
const RUN_LOCATIONS: ReadonlySet<string> = new Set([
  MY_COMPUTER,
  DRIVE_A,
  DRIVE_C,
  WINDOWS_LOCATION,
  SYSTEM32_LOCATION,
]);

/** The id a typed name stands for: lower case, without ".exe", through the aliases. */
export function runCommandId(text: string): string {
  const name = text
    .trim()
    .toLowerCase()
    .replace(/\.(exe|com|bat|lnk)$/, "");
  return RUN_ALIASES[name] ?? name;
}

/** Resolves a typed line to what it opens; pure, so the dialog and its tests share one answer. */
export function resolveRunCommand(text: string, games: GameLookup): RunTarget {
  const typed = text.trim();
  if (typed === "") return { type: "empty" };
  if (/^https?:\/\/\S+$/i.test(typed)) return { type: "url", url: typed };
  const id = runCommandId(typed);
  if (id === "bsod") return { type: "bsod" };
  if (games.has(id)) return { type: "fusegame", gameId: id };
  if (isGameId(id))
    return { type: "open", content: { kind: "retro", game: id } };
  const app = deepLinkApp(id);
  if (app) return { type: "open", content: app };
  // "C:\", "a:" or "C:\WINDOWS\SYSTEM32": Explorer on that folder.
  const location = parseAddress(typed);
  if (location !== undefined && RUN_LOCATIONS.has(location.toUpperCase()))
    return {
      type: "open",
      content: { kind: "explorer", location: location.toUpperCase() },
    };
  return { type: "notFound", text: typed };
}

/** What the Open box suggests: every name that runs something, the games first. */
export function runSuggestions(gameIds: readonly string[]): string[] {
  return [...gameIds, ...RUN_SUGGESTED_APPS];
}

const RUN_SUGGESTED_APPS = [
  "doom",
  "wolf3d",
  "keen1",
  "duke3d",
  "minesweeper",
  "solitaire",
  "fusteam",
  "winamp",
  "notepad",
  "explorer",
  "paint",
  "dosgames",
  "friends",
  "network",
  "halloffame",
  "taskmanager",
  "defrag",
  "recyclebin",
  "control",
  "bsod",
];
