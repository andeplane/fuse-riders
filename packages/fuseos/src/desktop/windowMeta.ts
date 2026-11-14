import type { FuseGameRegistry } from "../fusegames/registry";
import {
  LAUNCHER_TITLE,
  LAUNCHER_WINDOW_SIZE,
} from "../launcher/launcherFacts";
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

/** Room for the 275x348 main/equalizer/playlist stack and the file toolbar. */
export const WINAMP_WINDOW_SIZE: Size = { width: 320, height: 440 };

/** A Fuse game opens at the size its lobby is laid out for; the window clamps to the desktop. */
export const FUSE_GAME_WINDOW_SIZE: Size = { width: 1024, height: 700 };

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
        size: { width: 440, height: 360 },
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
    case "launcher":
      return {
        title: LAUNCHER_TITLE,
        icon: "fusteam",
        resizable: true,
        size: LAUNCHER_WINDOW_SIZE,
      };
  }
}
