import type { ColorMode, DesktopArea } from "../desktop/displayModes";
import type { DiskEntry } from "../disk/diskEntries";
import type { ColorSchemeId } from "../display/effects/colorSchemes";
import type { CrtMode } from "../display/effects/effectsStore";
import type { IntentTarget } from "../llm/intent";
import type { EditorCommands } from "../notepadpp/editorCommands";
import type { GameLaunch } from "../settings/fuseosPrefsStore";
import type { WindowContent, WindowKind } from "../state/appState";
import type { WinampControls } from "../winamp/winampControls";

/**
 * The desktop as Clippy's tools see it: one narrow port per thing a user can operate. `useAgentOs` builds the
 * real one from the desktop's contexts; tests hand in `createFakeAgentOs` (`__mocks__/agentOs.ts`). A port that
 * a build does not have (Run, before its dialog exists) is absent and its tools are not offered.
 */
export type WindowInfo = {
  id: string;
  kind: WindowKind;
  /** The title bar text, e.g. "Fuseball" or "untitled - Paint". */
  title: string;
  minimized: boolean;
  maximized: boolean;
  /** The window on top. */
  focused: boolean;
};

export interface WindowsPort {
  list(): WindowInfo[];
  open(content: WindowContent): void;
  close(id: string): void;
  focus(id: string): void;
  minimize(id: string): void;
  toggleMaximize(id: string): void;
  showInfo(title: string, message: string): void;
}

export interface StartMenuPort {
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

/** Something `open_app` opens: a Fuse game, a retro game or a desktop program. */
export type OpenTarget = IntentTarget & {
  kind: "game" | "retro" | "app";
  content: WindowContent;
};

export type GameInfo = { id: string; name: string; tagline: string };

export interface GamesPort {
  /** The Fuse games, in portal order. */
  fuse(): readonly GameInfo[];
  /** The retro games under Start, Programs, Games. */
  retro(): readonly { id: string; name: string }[];
  /** How a Fuse game starts without a mode: the Games applet's choice, else the device default. */
  launchMode(): GameLaunch;
  /** Starts a Fuse game in a window of the desktop or a browser tab; without a mode, the way the Games applet says. */
  launch(id: string, mode?: GameLaunch): GameLaunch;
}

export type DiskNode =
  | { kind: "folder"; entries: DiskEntry[] }
  | { kind: "file"; entry: DiskEntry }
  | undefined;

export interface DiskPort {
  /** What is at a location ("" is My Computer, "C:/docs", "A:"): a folder with its entries, a file, or nothing. */
  stat(location: string): Promise<DiskNode>;
}

export type EditorPort = Pick<
  EditorCommands,
  "open" | "readFile" | "writeFile" | "listModified" | "revert"
>;

export interface MusicPort {
  /** The running Winamp's transport; undefined while none has loaded. */
  controls(): WinampControls | undefined;
  /** Opens Winamp and presses Play once it has loaded. */
  openAndPlay(): void;
}

export type DisplayState = {
  colorMode: ColorMode;
  resolution: DesktopArea;
  crt: CrtMode;
  curvature: boolean;
  scheme: ColorSchemeId;
  largeFonts: boolean;
};

export interface DisplayPort {
  get(): DisplayState;
  setColorMode(mode: ColorMode): void;
  setResolution(area: DesktopArea): void;
  setCrt(mode: CrtMode): void;
  setCurvature(on: boolean): void;
  setScheme(scheme: ColorSchemeId): void;
  setLargeFonts(large: boolean): void;
}

export interface WallpaperPort {
  /** The solid background colour, and whether a picture covers it. */
  get(): { color: string; hasPicture: boolean };
  /** Sets the solid colour (a Windows 98 palette hex); a wallpaper picture is cleared, as in Display Properties. */
  setColor(hex: string): void;
}

export interface ScreenSaverPort {
  active(): boolean;
  /** Starts the saver now; throws when the desktop is shut down or the tab hidden. */
  preview(): void;
}

export type RunResult = { ok: boolean; message: string };

/** Start, Run: present only in a build that has the dialog (`AgentRunContext`). */
export interface RunPort {
  run(command: string): RunResult | Promise<RunResult>;
}

export type AgentOs = {
  windows: WindowsPort;
  startMenu: StartMenuPort;
  /** Everything `open_app` can open, Fuse games first. */
  targets: readonly OpenTarget[];
  games: GamesPort;
  disk: DiskPort;
  editor: EditorPort;
  music: MusicPort;
  display: DisplayPort;
  wallpaper: WallpaperPort;
  screenSaver: ScreenSaverPort;
  run?: RunPort;
};
