import { useContext } from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";
import type { WallpaperSource } from "../desktop/wallpaperStore";
import { useWindowCommands } from "../windows/useWindowCommands";

export type WallpaperWindowViewModel = {
  wallpaper: string | undefined;
  setWallpaper: (dataUrl: string | undefined, source: WallpaperSource) => void;
  backgroundColor: string;
  setBackgroundColor: (hex: string) => void;
  close: () => void;
};

/**
 * Start > Programs > Accessories > Change desktop background, and the matching
 * desktop icon: a small window over the same wallpaper picker and store Control
 * Panel, Display uses, so both stay in sync.
 */
export function useWallpaperWindowViewModel(
  windowId: string,
): WallpaperWindowViewModel {
  const { wallpaper, setWallpaper, backgroundColor, setBackgroundColor } =
    useContext(DesktopUiContext);
  const commands = useWindowCommands();
  return {
    wallpaper,
    setWallpaper,
    backgroundColor,
    setBackgroundColor,
    close: () => commands.close(windowId),
  };
}
