import type { GameId } from "../retro/gameIds";
import { isGameId } from "../retro/gameIds";

export type ControlPanelApplet =
  "home" | "display" | "system" | "assistant" | "keyboard" | "games";

/** A Fuse game (`games/<id>/`, listed in the portal) running in an iframe window. */
export interface FuseGameWindowContent {
  kind: "fusegame";
  /** The game's portal id, e.g. "fuseball". Validated against the registry when the window renders, not here. */
  gameId: string;
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

/** An image from the C: drive, shown read-only (Paint's URL import is Phase B5's; this is the fallback viewer). */
export interface ImageViewerWindowContent {
  kind: "imageviewer";
  path: string;
}

export type WindowContent =
  | FuseGameWindowContent
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
  | ImageViewerWindowContent;

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

export type AppAction =
  | { type: "open"; content: WindowContent; id?: string }
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
 * wallpaper picker, About, the Retro Games folder, Notepad++ with its tabs), one window per retro game, per
 * Fuse game, per Control Panel applet, per Explorer location and per picture. Paint and dialogs open as many
 * times as asked. `open` focuses the existing window instead of adding another, whatever asked: an icon, the
 * Start menu, Clippy or a `?open=` deep link over a stored desktop that already holds it.
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
      return existing.kind === content.kind;
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
    case "imageviewer":
      return existing.kind === "imageviewer" && existing.path === content.path;
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
      const existing =
        action.id === undefined
          ? state.windows.find((window) => sameInstance(action.content, window))
          : state.windows.find((window) => window.id === action.id);
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
      const id = action.id ?? nextWindowId(state.windows);
      return {
        ...state,
        windows: [
          ...state.windows,
          { id, minimized: false, maximized: false, ...action.content },
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
      return typeof value.gameId === "string" && value.gameId.length > 0;
    case "retro":
      return isGameId(value.game);
    case "controlpanel":
      return (
        isControlPanelApplet(value.applet) &&
        (value.tab === undefined || typeof value.tab === "string")
      );
    case "wallpaper":
    case "about":
    case "winamp":
    case "retroFolder":
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
    case "imageviewer":
      return typeof value.path === "string" && value.path.length > 0;
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
