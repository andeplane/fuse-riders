import { createContext } from "react";

import { MY_COMPUTER } from "../disk/diskPath";
import { LAUNCHER_TITLE } from "../launcher/launcherFacts";
import { openLauncher } from "../launcher/useOpenLauncher";
import { openNetworkNeighborhood } from "../network/openNetworkNeighborhood";
import type { IconName } from "../ui/icons";
import type { WindowCommands } from "../windows/useWindowCommands";
import type { Size } from "../windows/windowManager";

/**
 * Where a registered entry lands in the Start menu:
 * - `accessories`: Programs > Accessories (Paint, Winamp, Notepad++, ...)
 * - `programs`: Programs, after Accessories and Games (Fusteam, the game launcher)
 * - `games`: Programs > Games, after the Fuse games and before Retro Games
 * - `retro-games`: Programs > Games > Retro Games, before the games themselves (the folder window)
 * - `my-computer`: the top-level My Computer item itself (one registration fills it)
 * - `settings`: Settings, after Control Panel and its applets
 * - `help`: Help, after Help Topics and the Office Assistant
 */
export type StartMenuSlot =
  | "accessories"
  | "programs"
  | "games"
  | "retro-games"
  | "my-computer"
  | "settings"
  | "help";

export type StartMenuRegistration = {
  slot: StartMenuSlot;
  /** Unique within the menu; also the test id of the item. */
  id: string;
  label: string;
  icon: IconName;
  /**
   * What choosing the item does, given the window commands and the desktop's viewport (a program that
   * opens maximized on a small display). Absent means the program is not installed in this build: the
   * item shows disabled so the menu's shape is complete.
   */
  open?: (commands: WindowCommands, viewport: Size) => void;
  /** Lower first within a slot; registrations without one keep their list order after those with one. */
  order?: number;
  /** A menu separator under the item (Windows draws one under "Open folder" lines). */
  separatorAfter?: boolean;
};

/**
 * The programs other packages add to the Start menu. Appending an entry here is the whole
 * registration: `useStartMenuViewModel` reads this list, so nothing in `StartMenu.tsx` or the
 * view model needs editing. An entry without `open` shows disabled, so a program that is planned
 * but not in a build still has its place in the menu.
 */
export const START_MENU_REGISTRATIONS: readonly StartMenuRegistration[] = [
  {
    slot: "accessories",
    id: "paint",
    label: "Paint",
    icon: "paint",
    order: 10,
    open: (commands) => commands.open({ kind: "paint" }),
  },
  {
    slot: "accessories",
    id: "winamp",
    label: "Winamp",
    icon: "winamp",
    order: 20,
    open: (commands) => commands.open({ kind: "winamp" }),
  },
  {
    slot: "accessories",
    id: "notepadpp",
    label: "Notepad++",
    icon: "notepadpp",
    order: 30,
    open: (commands) =>
      commands.open({
        kind: "notepadpp",
        paths: ["README.md"],
        activePath: "README.md",
      }),
  },
  {
    slot: "accessories",
    id: "explorer",
    label: "Windows Explorer",
    icon: "explorer",
    order: 35,
    open: (commands) =>
      commands.open({ kind: "explorer", location: MY_COMPUTER }),
  },
  {
    slot: "accessories",
    id: "wallpaper",
    label: "Change desktop background",
    icon: "wallpaper",
    order: 40,
    open: (commands) => commands.open({ kind: "wallpaper" }),
  },
  {
    slot: "programs",
    id: "fusteam",
    label: LAUNCHER_TITLE,
    icon: "fusteam",
    order: 10,
    open: openLauncher,
  },
  {
    slot: "retro-games",
    id: "retro-folder",
    label: "Open Retro Games folder",
    icon: "folderOpen",
    open: (commands) => commands.open({ kind: "retroFolder" }),
    separatorAfter: true,
  },
  {
    slot: "my-computer",
    id: "my-computer",
    label: "My Computer",
    icon: "computer",
    open: (commands) =>
      commands.open({ kind: "explorer", location: MY_COMPUTER }),
  },
  {
    slot: "settings",
    id: "screensaver",
    label: "Screen Saver",
    icon: "display",
    open: (commands) =>
      commands.open({
        kind: "controlpanel",
        applet: "display",
        tab: "screensaver",
      }),
  },
  {
    slot: "programs",
    id: "halloffame",
    label: "Hall of Fame",
    icon: "trophy",
    order: 10,
    // One Hall of Fame at a time: choosing it again brings the open window to the front.
    open: (commands) =>
      commands.open({ kind: "halloffame" }, { id: HALL_OF_FAME_WINDOW_ID }),
  },
  {
    slot: "programs",
    id: "network-neighborhood",
    label: "Network Neighborhood",
    icon: "network",
    order: 10,
    open: (commands) => openNetworkNeighborhood(commands),
  },
  {
    slot: "programs",
    id: "friends",
    label: "Fuse Messenger",
    icon: "messenger",
    // One instance: a fixed id brings an open window to the front instead of opening another.
    open: (commands) => 
      commands.open({ kind: "friends" }, { id: FRIENDS_WINDOW_ID }),
  },
];

export const HALL_OF_FAME_WINDOW_ID = "halloffame";

/** The buddy list's window id; never one `nextWindowId` hands out (`w<n>`), so it is the same window every time. */
export const FRIENDS_WINDOW_ID = "friends";

/** The registrations in force; tests hand in their own list. */
export const StartMenuRegistryContext = createContext<
  readonly StartMenuRegistration[]
>(START_MENU_REGISTRATIONS);

/** The registrations for one slot, stable-sorted by `order` (entries without one last, in list order). */
export function registrationsFor(
  registrations: readonly StartMenuRegistration[],
  slot: StartMenuSlot,
): StartMenuRegistration[] {
  return registrations
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.slot === slot)
    .sort((a, b) => {
      const left = a.entry.order ?? Number.POSITIVE_INFINITY;
      const right = b.entry.order ?? Number.POSITIVE_INFINITY;
      return left === right ? a.index - b.index : left - right;
    })
    .map(({ entry }) => entry);
}
