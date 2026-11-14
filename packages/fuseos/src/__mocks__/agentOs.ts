import type {
  AgentOs,
  DiskNode,
  DisplayState,
  GameInfo,
  OpenTarget,
  WindowInfo,
} from "../agenttools/agentOs";
import type { DiskEntry } from "../disk/diskEntries";
import type { GameLaunch } from "../settings/fuseosPrefsStore";
import type { WindowContent } from "../state/appState";
import type { WinampControls } from "../winamp/winampControls";

/** A typed stand-in for the desktop behind Clippy's tools: everything in memory, every action recorded in `log`. */
export type FakeAgentOs = AgentOs & {
  /** What was done, in order, as short lines: "open paint", "close w1", "setColor #ff0000". */
  log: string[];
  state: {
    windows: WindowInfo[];
    startMenuOpen: boolean;
    display: DisplayState;
    backgroundColor: string;
    hasPicture: boolean;
    launchMode: GameLaunch;
    screenSaverActive: boolean;
    /** Winamp's state while it runs; undefined while it is closed. */
    winamp: { playing: boolean; track: number; volume?: number } | undefined;
    /** Editor paths with a saved copy, and their text. */
    saved: Record<string, string>;
    /** The files Notepad++ was asked to show. */
    opened: string[];
    dialogs: { title: string; message: string }[];
  };
  /** The committed text of every file, by editor path ("README.md", "A:/porn/homework.txt"). */
  files: Record<string, string>;
};

export const FAKE_GAMES: readonly GameInfo[] = [
  { id: "fuseball", name: "Fuseball", tagline: "Five-a-side with rockets" },
  { id: "fuse-riders", name: "Fuse Riders", tagline: "Light cycles for five" },
  { id: "fuse-birds", name: "Fuse Birds", tagline: "Flap, dodge, survive" },
];

export const FAKE_RETRO = [
  { id: "doom", name: "DOOM" },
  { id: "minesweeper", name: "Minesweeper" },
];

export const FAKE_TARGETS: readonly OpenTarget[] = [
  ...FAKE_GAMES.map((game): OpenTarget => ({
    id: game.id,
    name: game.name,
    kind: "game",
    content: { kind: "fusegame", gameId: game.id },
  })),
  {
    id: "doom",
    name: "DOOM",
    kind: "retro",
    content: { kind: "retro", game: "doom" },
  },
  {
    id: "minesweeper",
    name: "Minesweeper",
    kind: "retro",
    content: { kind: "retro", game: "minesweeper" },
  },
  {
    id: "paint",
    name: "Paint",
    kind: "app",
    content: { kind: "paint" },
    aliases: ["mspaint"],
  },
  { id: "winamp", name: "Winamp", kind: "app", content: { kind: "winamp" } },
  {
    id: "notepad",
    name: "Notepad++",
    kind: "app",
    content: {
      kind: "notepadpp",
      paths: ["README.md"],
      activePath: "README.md",
    },
  },
  {
    id: "explorer",
    name: "My Computer",
    kind: "app",
    content: { kind: "explorer", location: "" },
  },
  {
    id: "settings",
    name: "Control Panel",
    kind: "app",
    content: { kind: "controlpanel", applet: "home" },
    aliases: ["settings"],
  },
];

export const FAKE_FILES: Readonly<Record<string, string>> = {
  "README.md": "# Fuse Riders\n\nLight cycles for five.\n",
  "docs/notes.txt": "plain notes\n",
  "docs/guide/intro.md": "Welcome.\n",
  "A:/porn/homework.txt": "Nice try. Go play Fuseball.\n",
};

function titleOf(
  content: WindowContent,
  targets: readonly OpenTarget[],
): string {
  switch (content.kind) {
    case "fusegame":
      return (
        targets.find((target) => target.id === content.gameId)?.name ??
        content.gameId
      );
    case "retro":
      return (
        targets.find((target) => target.id === content.game)?.name ??
        content.game
      );
    case "paint":
      return "untitled - Paint";
    case "winamp":
      return "Winamp";
    case "notepadpp":
      return `${content.activePath ?? "new 1"} - Notepad++`;
    case "explorer":
      return content.location === ""
        ? "My Computer"
        : `Exploring - ${content.location}`;
    case "dialog":
      return content.title;
    case "controlpanel":
      return "Control Panel";
    default:
      return content.kind;
  }
}

function fileEntry(location: string, size: number): DiskEntry {
  const name = location.slice(location.lastIndexOf("/") + 1);
  const text = /\.(md|txt|ts|tsx|json)$/.test(name);
  return {
    location,
    name,
    kind: "file",
    icon: "textFile",
    typeLabel: text ? "Text Document" : "File",
    size,
    modified: false,
    fileKind: text ? "text" : "binary",
  };
}

function folderEntry(location: string): DiskEntry {
  return {
    location,
    name: location.slice(location.lastIndexOf("/") + 1),
    kind: "folder",
    icon: "folder",
    typeLabel: "File Folder",
    modified: false,
  };
}

/** Where a file lives as Explorer addresses it: repository paths are on C:. */
function locationOf(path: string): string {
  return /^[A-Z]:/.test(path) ? path : `C:/${path}`;
}

export function createFakeAgentOs(
  options: {
    files?: Readonly<Record<string, string>>;
    /** Sizes for files that are not text, by location: `{ "C:/public/theme.mp3": 2048 }`. */
    binaries?: Readonly<Record<string, number>>;
    withRun?: boolean;
    /** A Winamp without a volume control, as an older player would be. */
    noVolume?: boolean;
  } = {},
): FakeAgentOs {
  const log: string[] = [];
  const files: Record<string, string> = { ...(options.files ?? FAKE_FILES) };
  let nextId = 1;
  const state: FakeAgentOs["state"] = {
    windows: [],
    startMenuOpen: false,
    display: {
      colorMode: "true-color",
      resolution: "current",
      crt: "off",
      curvature: false,
      scheme: "windows-standard",
      largeFonts: false,
    },
    backgroundColor: "#008080",
    hasPicture: false,
    launchMode: "window",
    screenSaverActive: false,
    winamp: undefined,
    saved: {},
    opened: [],
    dialogs: [],
  };
  const refocus = () => {
    const top = [...state.windows]
      .reverse()
      .find((window) => !window.minimized);
    state.windows = state.windows.map((window) => ({
      ...window,
      focused: window === top,
    }));
  };
  const toFront = (id: string) => {
    const window = state.windows.find((candidate) => candidate.id === id);
    if (!window) return;
    state.windows = [
      ...state.windows.filter((candidate) => candidate.id !== id),
      { ...window, minimized: false },
    ];
    refocus();
  };
  const openWindow = (content: WindowContent) => {
    const title = titleOf(content, FAKE_TARGETS);
    const existing = state.windows.find(
      (window) => window.kind === content.kind && window.title === title,
    );
    if (existing && content.kind !== "paint" && content.kind !== "dialog") {
      toFront(existing.id);
      return;
    }
    state.windows = [
      ...state.windows,
      {
        id: `w${nextId}`,
        kind: content.kind,
        title,
        minimized: false,
        maximized: false,
        focused: true,
      },
    ];
    nextId += 1;
    refocus();
    if (content.kind === "winamp" && !state.winamp)
      state.winamp = { playing: false, track: 0 };
  };
  const winampControls = (): WinampControls | undefined => {
    const winamp = state.winamp;
    if (!winamp) return undefined;
    const controls: WinampControls = {
      status: () => ({
        trackCount: 3,
        tracks: ["One", "Two", "Three"],
        currentTrack: ["One", "Two", "Three"][winamp.track % 3],
        playing: winamp.playing,
      }),
      play: () => {
        log.push("music play");
        winamp.playing = true;
      },
      pause: () => {
        log.push("music pause");
        winamp.playing = false;
      },
      stop: () => {
        log.push("music stop");
        winamp.playing = false;
      },
      next: () => {
        log.push("music next");
        winamp.track += 1;
      },
      previous: () => {
        log.push("music previous");
        winamp.track -= 1;
      },
    };
    if (options.noVolume) return controls;
    return {
      ...controls,
      setVolume: (percent) => {
        log.push(`music volume ${percent}`);
        winamp.volume = percent;
      },
    };
  };
  const allLocations = (): { location: string; size: number }[] => [
    ...Object.entries(files).map(([path, text]) => ({
      location: locationOf(path),
      size: text.length,
    })),
    ...Object.entries(options.binaries ?? {}).map(([location, size]) => ({
      location,
      size,
    })),
  ];
  const stat = (location: string): DiskNode => {
    if (location === "")
      return {
        kind: "folder",
        entries: [folderEntry("A:"), folderEntry("C:")],
      };
    const all = allLocations();
    const file = all.find(
      (candidate) =>
        candidate.location.toLowerCase() === location.toLowerCase(),
    );
    if (file)
      return { kind: "file", entry: fileEntry(file.location, file.size) };
    const prefix = `${location}/`;
    const inside = all.filter((candidate) =>
      candidate.location.startsWith(prefix),
    );
    if (inside.length === 0 && location !== "C:" && location !== "A:")
      return undefined;
    const folders = new Set<string>();
    const entries: DiskEntry[] = [];
    for (const candidate of inside) {
      const rest = candidate.location.slice(prefix.length);
      const cut = rest.indexOf("/");
      if (cut < 0) entries.push(fileEntry(candidate.location, candidate.size));
      else folders.add(`${prefix}${rest.slice(0, cut)}`);
    }
    return {
      kind: "folder",
      entries: [...[...folders].sort().map(folderEntry), ...entries],
    };
  };
  const os: FakeAgentOs = {
    log,
    state,
    files,
    windows: {
      list: () => state.windows,
      open: (content) => {
        log.push(`open ${titleOf(content, FAKE_TARGETS)}`);
        openWindow(content);
      },
      close: (id) => {
        log.push(`close ${id}`);
        const closed = state.windows.find((window) => window.id === id);
        state.windows = state.windows.filter((window) => window.id !== id);
        if (closed?.kind === "winamp") state.winamp = undefined;
        refocus();
      },
      focus: (id) => {
        log.push(`focus ${id}`);
        toFront(id);
      },
      minimize: (id) => {
        log.push(`minimize ${id}`);
        state.windows = state.windows.map((window) =>
          window.id === id ? { ...window, minimized: true } : window,
        );
        refocus();
      },
      toggleMaximize: (id) => {
        log.push(`toggleMaximize ${id}`);
        state.windows = state.windows.map((window) =>
          window.id === id
            ? { ...window, maximized: !window.maximized }
            : window,
        );
      },
      showInfo: (title, message) => {
        log.push(`showInfo ${title}: ${message}`);
        state.dialogs.push({ title, message });
        openWindow({ kind: "dialog", title, message, icon: "info" });
      },
    },
    startMenu: {
      isOpen: () => state.startMenuOpen,
      setOpen: (open) => {
        log.push(`startMenu ${open ? "open" : "closed"}`);
        state.startMenuOpen = open;
      },
    },
    targets: FAKE_TARGETS,
    games: {
      fuse: () => FAKE_GAMES,
      retro: () => FAKE_RETRO,
      launchMode: () => state.launchMode,
      launch: (id, mode) => {
        const chosen = mode ?? state.launchMode;
        log.push(`launch ${id} ${chosen}`);
        if (chosen === "window") openWindow({ kind: "fusegame", gameId: id });
        return chosen;
      },
    },
    disk: { stat: async (location) => stat(location) },
    editor: {
      open: (path) => {
        log.push(`edit-open ${path}`);
        state.opened.push(path);
        openWindow({ kind: "notepadpp", paths: [path], activePath: path });
      },
      readFile: async (path) => {
        const text = state.saved[path] ?? files[path];
        if (text === undefined) throw new Error(`There is no ${path}`);
        return text;
      },
      writeFile: async (path, content) => {
        log.push(`write ${path}`);
        state.saved[path] = content;
      },
      listModified: async () => Object.keys(state.saved),
      revert: async (path) => {
        log.push(`revert ${path}`);
        delete state.saved[path];
      },
    },
    music: {
      controls: winampControls,
      openAndPlay: () => {
        log.push("music openAndPlay");
        openWindow({ kind: "winamp" });
        if (state.winamp) state.winamp.playing = true;
      },
    },
    display: {
      get: () => state.display,
      setColorMode: (colorMode) => {
        log.push(`colorMode ${colorMode}`);
        state.display = { ...state.display, colorMode };
      },
      setResolution: (resolution) => {
        log.push(`resolution ${resolution}`);
        state.display = { ...state.display, resolution };
      },
      setCrt: (crt) => {
        log.push(`crt ${crt}`);
        state.display = { ...state.display, crt };
      },
      setCurvature: (curvature) => {
        log.push(`curvature ${curvature}`);
        state.display = { ...state.display, curvature };
      },
      setScheme: (scheme) => {
        log.push(`scheme ${scheme}`);
        state.display = { ...state.display, scheme };
      },
      setLargeFonts: (largeFonts) => {
        log.push(`largeFonts ${largeFonts}`);
        state.display = { ...state.display, largeFonts };
      },
    },
    wallpaper: {
      get: () => ({
        color: state.backgroundColor,
        hasPicture: state.hasPicture,
      }),
      setColor: (hex) => {
        log.push(`setColor ${hex}`);
        state.backgroundColor = hex;
        state.hasPicture = false;
      },
    },
    screenSaver: {
      active: () => state.screenSaverActive,
      preview: () => {
        log.push("screensaver preview");
        state.screenSaverActive = true;
      },
    },
  };
  if (options.withRun)
    os.run = {
      run: (command) => {
        log.push(`run ${command}`);
        return command.trim() === ""
          ? { ok: false, message: "Type the name of a program" }
          : { ok: true, message: `Ran ${command}` };
      },
    };
  return os;
}
