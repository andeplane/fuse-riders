import { formatAddress, MY_COMPUTER } from "../disk/diskPath";
import type { FuseGameRegistry } from "../fusegames/registry";
import { GAMES } from "../retro/games";
import type { WindowState } from "../state/appState";
import type { IconRef } from "../ui/icons";
import type { Size } from "../windows/windowManager";

export type WindowMeta = {
  title: string;
  icon: IconRef;
  resizable: boolean;
  size?: Size;
};

/** Room for the 640x400 canvas next to the toolbox, above the palette and status bar. */
export const PAINT_WINDOW_SIZE: Size = { width: 780, height: 580 };

/** Room for the monitor preview, the picker buttons and Apply/OK/Cancel. */
export const WALLPAPER_WINDOW_SIZE: Size = { width: 320, height: 400 };

/** Winamp has no FuseOS frame (Webamp draws its own windows); the size is nominal, for the window list's sake. */
export const WINAMP_WINDOW_SIZE: Size = { width: 275, height: 464 };

/** A Fuse game opens at the size its lobby is laid out for; the window clamps to the desktop. */
export const FUSE_GAME_WINDOW_SIZE: Size = { width: 1024, height: 700 };

/** Room for the splash, the version lines, the licence line and a scrolling credits list. */
export const ABOUT_WINDOW_SIZE: Size = { width: 480, height: 540 };

/** Room for two rows of eight large icons, or the Details licence table, above the status bar. */
export const RETRO_FOLDER_WINDOW_SIZE: Size = { width: 640, height: 420 };

/** Room for the folders pane next to a Details listing. */
export const EXPLORER_WINDOW_SIZE: Size = { width: 720, height: 480 };

/** Room for the tab bar, a code pane with line numbers and the six-field status bar. */
export const NOTEPADPP_WINDOW_SIZE: Size = { width: 760, height: 520 };

export const OS_NAME = "FuseOS";

/** Title bar text and icon for each window kind. */
export function windowMeta(
  window: WindowState,
  games: Pick<FuseGameRegistry, "find" | "icon">,
): WindowMeta {
  switch (window.kind) {
    case "fusegame": {
      const game = games.find(window.gameId);
      return {
        title: game?.name ?? window.gameId,
        icon: (game && games.icon(game)) ?? "fusegame",
        resizable: true,
        size: FUSE_GAME_WINDOW_SIZE,
      };
    }
    case "retro":
      return {
        title: GAMES[window.game].name,
        icon: GAMES[window.game].icon,
        resizable: true,
        size: GAMES[window.game].windowSize,
      };
    case "retroFolder":
      return {
        title: "Retro Games",
        icon: "gamesFolder",
        resizable: true,
        size: RETRO_FOLDER_WINDOW_SIZE,
      };
    case "controlpanel":
      return { title: "Control Panel", icon: "settings", resizable: true };
    case "wallpaper":
      return {
        title: "Change desktop background",
        icon: "wallpaper",
        resizable: false,
        size: WALLPAPER_WINDOW_SIZE,
      };
    case "about":
      return {
        title: `About ${OS_NAME}`,
        icon: "help",
        resizable: false,
        size: ABOUT_WINDOW_SIZE,
      };
    case "dialog":
      return { title: window.title, icon: window.icon, resizable: false };
    case "paint":
      return {
        title: `${window.fileName ?? "untitled"} - Paint`,
        icon: "paint",
        resizable: true,
        size: PAINT_WINDOW_SIZE,
      };
    case "winamp":
      return {
        title: "Winamp",
        icon: "winamp",
        resizable: false,
        size: WINAMP_WINDOW_SIZE,
      };
    case "explorer":
      return {
        title:
          window.location === MY_COMPUTER
            ? "My Computer"
            : `Exploring - ${formatAddress(window.location)}`,
        icon: window.location === MY_COMPUTER ? "computer" : "explorer",
        resizable: true,
        size: EXPLORER_WINDOW_SIZE,
      };
    case "notepadpp": {
      const active = window.activePath ?? window.paths[window.paths.length - 1];
      const name = active?.slice(active.lastIndexOf("/") + 1) ?? "new 1";
      return {
        title: `${name} - Notepad++`,
        icon: "notepadpp",
        resizable: true,
        size: NOTEPADPP_WINDOW_SIZE,
      };
    }
  }
}
