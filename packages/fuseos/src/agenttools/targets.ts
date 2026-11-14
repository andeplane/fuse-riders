import { MY_COMPUTER } from "../disk/diskPath";
import type { FuseGameRegistry } from "../fusegames/registry";
import { GAMES } from "../retro/games";
import { GAME_IDS } from "../retro/gameIds";
import type { ControlPanelApplet } from "../state/appState";

import type { OpenTarget } from "./agentOs";

function applet(
  id: string,
  name: string,
  which: ControlPanelApplet,
  aliases: readonly string[],
  tab?: string,
): OpenTarget {
  return {
    id,
    name,
    kind: "app",
    content:
      tab === undefined
        ? { kind: "controlpanel", applet: which }
        : { kind: "controlpanel", applet: which, tab },
    aliases,
  };
}

/** The programs on the desktop and in the Start menu, by the id Clippy opens them with. */
export const APP_TARGETS: readonly OpenTarget[] = [
  {
    id: "paint",
    name: "Paint",
    kind: "app",
    content: { kind: "paint" },
    aliases: ["mspaint"],
  },
  {
    id: "winamp",
    name: "Winamp",
    kind: "app",
    content: { kind: "winamp" },
    aliases: ["music player"],
  },
  applet("settings", "Control Panel", "home", [
    "settings",
    "options",
    "preferences",
  ]),
  applet("display", "Display Properties", "display", [
    "wallpaper",
    "background",
    "display settings",
  ]),
  {
    id: "about",
    name: "About FuseOS",
    kind: "app",
    content: { kind: "about" },
    aliases: ["about", "credits", "version"],
  },
  {
    id: "notepad",
    name: "Notepad++",
    kind: "app",
    content: {
      kind: "notepadpp",
      paths: ["README.md"],
      activePath: "README.md",
    },
    aliases: ["notepadpp", "notepad plus plus", "editor", "text editor"],
  },
  {
    id: "explorer",
    name: "My Computer",
    kind: "app",
    content: { kind: "explorer", location: MY_COMPUTER },
    aliases: ["windows explorer", "file explorer", "files", "file manager"],
  },
  {
    id: "fusteam",
    name: "Fusteam",
    kind: "app",
    content: { kind: "launcher" },
    aliases: ["launcher", "game launcher", "steam", "library"],
  },
  {
    id: "retro-games",
    name: "Retro Games",
    kind: "app",
    content: { kind: "retroFolder" },
    aliases: ["retro games folder", "retro folder", "dos games"],
  },
  {
    id: "defrag",
    name: "Disk Defragmenter",
    kind: "app",
    content: { kind: "defrag" },
    aliases: ["defragmenter", "defragment", "disk defrag"],
  },
  applet(
    "screensaver",
    "Screen Saver settings",
    "display",
    ["screen saver settings", "screensaver settings"],
    "screensaver",
  ),
  applet("system", "System Properties", "system", ["system", "system info"]),
  applet("assistant", "Assistant settings", "assistant", [
    "assistant options",
    "clippy settings",
    "clippy options",
  ]),
  applet("keyboard", "Keyboard settings", "keyboard", [
    "keyboard",
    "shortcuts",
  ]),
  applet("games-settings", "Games settings", "games", ["game settings"]),
];

/** Every id Clippy can open, Fuse games first: the registry's games, the retro games, then the programs. */
export function desktopTargets(games: FuseGameRegistry): OpenTarget[] {
  return [
    ...games.games.map((game): OpenTarget => ({
      id: game.id,
      name: game.name,
      kind: "game",
      content: { kind: "fusegame", gameId: game.id },
    })),
    ...GAME_IDS.map((id): OpenTarget => {
      const game = GAMES[id];
      return {
        id,
        name: game.name,
        kind: "retro",
        content: { kind: "retro", game: id },
        // "Commander Keen 1: Marooned on Mars" is "Keen" to everyone.
        aliases: id === "keen1" ? ["keen", "commander keen"] : undefined,
      };
    }),
    ...APP_TARGETS,
  ];
}
