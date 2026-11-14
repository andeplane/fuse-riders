import { isRoomCode } from "../network/roomCode";
import type { GameId } from "../retro/gameIds";
import { isGameId } from "../retro/gameIds";

export type ControlPanelApplet =
  "home" | "display" | "system" | "assistant" | "keyboard" | "games" | "sounds";

/** A Fuse game (`games/<id>/`, listed in the portal) running in an iframe window. */
export interface FuseGameWindowContent {
  kind: "fusegame";
  /** The game's portal id, e.g. "fuseball". Validated against the registry when the window renders, not here. */
  gameId: string;
  /** A room to join on open (`?room=`), e.g. from a friend's "Join game"; absent opens the game's own landing page. */
  room?: string;
}

/** Fuse Messenger, the buddy list (Start > Programs > Fuse Messenger, the tray icon, `?open=friends`). One instance. */
export interface FriendsWindowContent {
  kind: "friends";
}

/** One of the retro games under Start > Programs > Games (DOS bundles, vendored web games, Minesweeper, Solitaire). */
export interface RetroGameWindowContent {
  kind: "retro";
  game: GameId;
}

/** Start > Programs > Games > Retro Games: a folder window listing the retro games as icons. Reused when already open. */
export interface RetroFolderWindowContent {
  kind: "retroFolder";
}

export interface ControlPanelWindowContent {
  kind: "controlpanel";
  applet: ControlPanelApplet;
  /** The tab the applet opens on (Display Properties: "screensaver"); absent for the first one. */
  tab?: string;
}

/** Start > Programs > Accessories > Change desktop background: a small window over the wallpaper picker. Reused when already open. */
export interface WallpaperWindowContent {
  kind: "wallpaper";
}

export interface AboutWindowContent {
  kind: "about";
}

export interface DialogWindowContent {
  kind: "dialog";
  title: string;
  message: string;
  icon: "warning" | "info";
}

export interface PaintWindowContent {
  kind: "paint";
  /** Name of the local file on the canvas; absent for a new drawing. */
  fileName?: string;
  /** An image to fetch and draw when the window mounts (Explorer opening a repo image); Save downloads a copy, never writes back. */
  sourceUrl?: string;
}

/** Winamp: a media player over Webamp. The playlist itself is transient (object URLs do not survive a reload). Reused when already open. */
export interface WinampWindowContent {
  kind: "winamp";
}

/** Explorer over My Computer: `location` is "" (My Computer), "C:", "C:/packages/fuseos", "A:" (see disk/diskPath.ts). */
export interface ExplorerWindowContent {
  kind: "explorer";
  location: string;
}

/** Notepad++ with its open tabs (repository paths or "A:/..." locations); drafts live in the window, saves in the overlay. Reused when already open. */
export interface NotepadPlusPlusWindowContent {
  kind: "notepadpp";
  paths: string[];
  activePath?: string;
}

/** Fusteam, the game launcher (`src/launcher`): opens on every boot (above Winamp), one instance, focused rather than duplicated. */
export interface LauncherWindowContent {
  kind: "launcher";
}

/** The Recycle Bin's Explorer-style window. Reused when already open. */
export interface RecycleBinWindowContent {
  kind: "recyclebin";
}

/** A fake Windows Media Player "playing" one of the Recycle Bin's video files. */
export interface MediaPlayerWindowContent {
  kind: "mediaplayer";
  /** The file name shown in the title bar and the codec error. */
  file: string;
  /** The Fuse game this "video" turns out to be, launched once it has "buffered"; absent means the codec is missing. */
  launches?: string;
}

/** Start > Programs > Hall of Fame: one Fuse game's leaderboard. The picked game is kept so a reload shows it again. */
export interface HallOfFameWindowContent {
  kind: "halloffame";
  /** A portal game id; absent (or no longer installed) means the first game. */
  gameId?: string;
}

/** Network Neighborhood: rooms by game, recent rooms, Join room. One instance. */
export interface NetworkWindowContent {
  kind: "network";
}

/** A Fuse game opened straight into an online room (`?room=CODE`) by the Network Neighborhood. */
export interface RoomGameWindowContent {
  kind: "roomgame";
  gameId: string;
  /** The room code as the service issues it, e.g. "AB42"; validated by `isRoomCode` when stored. */
  code: string;
}

/** Task Manager (Ctrl+Shift+Esc): open windows, frame rates, heap. Reused when already open. */
export interface TaskManagerWindowContent {
  kind: "taskmanager";
}

/** Start > Run...: the one-line Run box (`src/run`). One instance. */
export interface RunWindowContent {
  kind: "run";
}

/** Dial-Up Networking's "Connect To" dialog (`sounds/dialup`); on connect it closes and opens `then`, when given. */
export interface DialUpWindowContent {
  kind: "dialup";
  then?: WindowContent;
}

export type WindowContent =
  | FuseGameWindowContent
  | NetworkWindowContent
  | RoomGameWindowContent
  | RetroGameWindowContent
  | RetroFolderWindowContent
  | ControlPanelWindowContent
  | WallpaperWindowContent
  | AboutWindowContent
  | DialogWindowContent
  | PaintWindowContent
  | WinampWindowContent
  | ExplorerWindowContent
  | NotepadPlusPlusWindowContent
  | LauncherWindowContent
  | RecycleBinWindowContent
  | MediaPlayerWindowContent
  | HallOfFameWindowContent
  | FriendsWindowContent
  | TaskManagerWindowContent
  | DialUpWindowContent
  | RunWindowContent;

export type WindowKind = WindowContent["kind"];

export type WindowState = {
  id: string;
  minimized: boolean;
  maximized: boolean;
} & WindowContent;

export interface AppState {
  version: 1;
  windows: WindowState[];
  /** The Office Assistant was hidden (right click, Hide; Start, Help, Office Assistant). Absent means shown. */
  assistantHidden?: boolean;
}

export const DEFAULT_STATE: AppState = { version: 1, windows: [] };

/** How `open` creates a window it does not find already open; an existing one keeps its id and size state. */
export type OpenOptions = {
  /** A fixed id (the launcher's) instead of the next `w<n>`; an open window under that id is focused instead. */
  id?: string;
  /** Opens maximized (the launcher on a display it would not fit); default restored. */
  maximized?: boolean;
};

export type AppAction =
  | { type: "open"; content: WindowContent; options?: OpenOptions }
  | { type: "close"; id: string }
  | { type: "focus"; id: string }
  | { type: "minimize"; id: string }
  | { type: "toggleMaximize"; id: string }
  | { type: "patch"; id: string; patch: (window: WindowState) => WindowState }
  | { type: "setAssistantHidden"; hidden: boolean }
  | { type: "replace"; state: AppState };

export function nextWindowId(windows: readonly WindowState[]): string {
  const max = windows.reduce((acc, window) => {
    const match = /^w(\d+)$/.exec(window.id);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `w${max + 1}`;
}

/**
 * Whether `content` would open the same window as `existing`: the single-instance programs (Winamp, the
 * wallpaper picker, About, the Retro Games folder, the Fusteam launcher, Notepad++ with its tabs), one window per
 * retro game, per Fuse game, per Control Panel applet, per Explorer location and per picture. Paint and dialogs
 * open as many times as asked. `open` focuses the existing window instead of adding another, whatever asked: an
 * icon, the Start menu, Clippy or a `?open=` deep link over a stored desktop that already holds it (the boot's
 * launcher, say).
 */
export function sameInstance(
  content: WindowContent,
  existing: WindowContent,
): boolean {
  switch (content.kind) {
    case "winamp":
    case "wallpaper":
    case "about":
    case "retroFolder":
    case "launcher":
    case "recyclebin":
    case "halloffame":
    case "network":
    case "friends":
    case "taskmanager":
    case "dialup":
    case "run":
      return existing.kind === content.kind;
    case "roomgame":
      return (
        existing.kind === "roomgame" &&
        existing.gameId === content.gameId &&
        existing.code === content.code
      );
    case "mediaplayer":
      return existing.kind === "mediaplayer" && existing.file === content.file;
    case "retro":
      return existing.kind === "retro" && existing.game === content.game;
    case "fusegame":
      return existing.kind === "fusegame" && existing.gameId === content.gameId;
    case "controlpanel":
      return (
        existing.kind === "controlpanel" && existing.applet === content.applet
      );
    case "notepadpp":
      return existing.kind === "notepadpp";
    case "explorer":
      return (
        existing.kind === "explorer" && existing.location === content.location
      );
    case "paint":
    case "dialog":
      return false;
  }
}

/**
 * What re-opening an instance asks of the window it already has: the Display dialog switches to the tab
 * named (Start > Settings > Screen Saver while it is up), Notepad++ gains the files as tabs and shows the
 * one asked for; everything else keeps the window as it is.
 */
export function mergeInstance(
  existing: WindowState,
  content: WindowContent,
): WindowState {
  if (existing.kind === "controlpanel" && content.kind === "controlpanel")
    return content.tab === undefined
      ? existing
      : { ...existing, tab: content.tab };
  // A friend's "Join game" over a window of that game already open: the window joins the room.
  if (
    existing.kind === "fusegame" &&
    content.kind === "fusegame" &&
    content.room !== undefined
  )
    return { ...existing, room: content.room };
  // Fusteam's Leaderboard link over an open Hall of Fame: the window turns to that game.
  if (
    existing.kind === "halloffame" &&
    content.kind === "halloffame" &&
    content.gameId !== undefined
  )
    return { ...existing, gameId: content.gameId };
  if (existing.kind === "notepadpp" && content.kind === "notepadpp") {
    const added = content.paths.filter(
      (path) => !existing.paths.includes(path),
    );
    return {
      ...existing,
      paths: [...existing.paths, ...added],
      activePath: content.activePath ?? content.paths[0] ?? existing.activePath,
    };
  }
  return existing;
}

function toFront(windows: WindowState[], id: string): WindowState[] {
  const target = windows.find((window) => window.id === id);
  if (!target) return windows;
  return [
    ...windows.filter((window) => window.id !== id),
    { ...target, minimized: false },
  ];
}

function patchWindow(
  windows: WindowState[],
  id: string,
  patch: (window: WindowState) => WindowState,
): WindowState[] {
  return windows.map((window) => (window.id === id ? patch(window) : window));
}

export function appStateReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "open": {
      const options = action.options ?? {};
      // The same program by kind first (a launcher a deep link once stored under a generated id), then by id.
      const existing =
        state.windows.find((window) => sameInstance(action.content, window)) ??
        (options.id === undefined
          ? undefined
          : state.windows.find((window) => window.id === options.id));
      if (existing) {
        return {
          ...state,
          windows: toFront(
            patchWindow(state.windows, existing.id, (window) =>
              mergeInstance(window, action.content),
            ),
            existing.id,
          ),
        };
      }
      const id = options.id ?? nextWindowId(state.windows);
      return {
        ...state,
        windows: [
          ...state.windows,
          {
            id,
            minimized: false,
            maximized: options.maximized ?? false,
            ...action.content,
          },
        ],
      };
    }
    case "close":
      return {
        ...state,
        windows: state.windows.filter((window) => window.id !== action.id),
      };
    case "focus":
      return { ...state, windows: toFront(state.windows, action.id) };
    case "minimize":
      return {
        ...state,
        windows: patchWindow(state.windows, action.id, (window) => ({
          ...window,
          minimized: true,
        })),
      };
    case "toggleMaximize":
      return {
        ...state,
        windows: toFront(
          patchWindow(state.windows, action.id, (window) => ({
            ...window,
            maximized: !window.maximized,
          })),
          action.id,
        ),
      };
    case "patch":
      return {
        ...state,
        windows: patchWindow(state.windows, action.id, action.patch),
      };
    case "setAssistantHidden": {
      // Absent means shown, so a shown assistant leaves nothing behind in storage.
      const { assistantHidden: _hidden, ...rest } = state;
      return action.hidden ? { ...rest, assistantHidden: true } : rest;
    }
    case "replace":
      return action.state;
  }
}

/** The active window is the top-most window that is not minimized. */
export function activeWindowId(state: AppState): string | null {
  for (let index = state.windows.length - 1; index >= 0; index -= 1) {
    const window = state.windows[index];
    if (window && !window.minimized) return window.id;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const APPLETS = new Set<string>([
  "home",
  "display",
  "system",
  "assistant",
  "keyboard",
  "games",
  "sounds",
]);

export function isControlPanelApplet(
  value: unknown,
): value is ControlPanelApplet {
  return typeof value === "string" && APPLETS.has(value);
}

function isWindowContent(
  value: Record<string, unknown>,
): value is Record<string, unknown> & WindowContent {
  switch (value.kind) {
    case "fusegame":
      return (
        typeof value.gameId === "string" &&
        value.gameId.length > 0 &&
        (value.room === undefined || isRoomCode(value.room))
      );
    case "retro":
      return isGameId(value.game);
    case "controlpanel":
      return (
        isControlPanelApplet(value.applet) &&
        (value.tab === undefined || typeof value.tab === "string")
      );
    case "roomgame":
      return (
        typeof value.gameId === "string" &&
        value.gameId.length > 0 &&
        isRoomCode(value.code)
      );
    case "wallpaper":
    case "about":
    case "winamp":
    case "retroFolder":
    case "launcher":
    case "network":
    case "friends":
    case "taskmanager":
      return true;
    case "dialog":
      return (
        typeof value.title === "string" &&
        typeof value.message === "string" &&
        (value.icon === "warning" || value.icon === "info")
      );
    case "paint":
      return (
        (value.fileName === undefined || typeof value.fileName === "string") &&
        (value.sourceUrl === undefined || typeof value.sourceUrl === "string")
      );
    case "explorer":
      return typeof value.location === "string";
    case "notepadpp":
      return (
        Array.isArray(value.paths) &&
        value.paths.every((path) => typeof path === "string") &&
        (value.activePath === undefined || typeof value.activePath === "string")
      );
    case "halloffame":
      return value.gameId === undefined || typeof value.gameId === "string";
    case "dialup":
      return (
        value.then === undefined ||
        (isRecord(value.then) && isWindowContent(value.then))
      );
    case "recyclebin":
    case "run":
      return true;
    case "mediaplayer":
      return (
        typeof value.file === "string" &&
        value.file.length > 0 &&
        (value.launches === undefined || typeof value.launches === "string")
      );
    default:
      return false;
  }
}

export function isWindowState(value: unknown): value is WindowState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.minimized === "boolean" &&
    typeof value.maximized === "boolean" &&
    isWindowContent(value)
  );
}

export function isAppState(value: unknown): value is AppState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.windows) &&
    value.windows.every(isWindowState) &&
    (value.assistantHidden === undefined ||
      typeof value.assistantHidden === "boolean")
  );
}

/** Parses a stored state; falls back to the default on any problem (an old shape, a corrupt entry). */
export function parseAppState(serialized: string | null | undefined): AppState {
  if (!serialized) return DEFAULT_STATE;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isAppState(parsed) ? parsed : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

/** Serializes the state for storage, dropping transient dialogs. */
export function serializeAppState(state: AppState): string {
  return JSON.stringify({
    ...state,
    windows: state.windows.filter((window) => window.kind !== "dialog"),
  });
}
