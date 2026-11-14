import { useCallback, useContext } from "react";

import { MY_COMPUTER } from "../disk/diskPath";
import { FuseGamesContext } from "../fusegames/registry";
import { useFuseGameLauncher } from "../fusegames/useFuseGameLauncher";
import { LAUNCHER_TITLE } from "../launcher/launcherFacts";
import { useOpenLauncher } from "../launcher/useOpenLauncher";
import { useGameLaunch } from "../settings/useGameLaunch";
import type { WindowState } from "../state/appState";
import { activeWindowId } from "../state/appState";
import { useAppState } from "../state/useAppState";
import type { MenuPosition } from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { DesktopIconArt } from "./DesktopIcon";
import type { DesktopIconMenu } from "./desktopUiContext";
import { DesktopUiContext } from "./desktopUiContext";

export type DesktopIconModel = {
  id: string;
  label: string;
  icon: DesktopIconArt;
  /** The Windows shortcut arrow: the program opens in a browser tab here (the Games applet's choice). */
  shortcut?: boolean;
  open: () => void;
};

export type DesktopViewModel = {
  icons: DesktopIconModel[];
  selectedIcon: string | null;
  selectIcon: (id: string | null) => void;
  /** The open desktop icon context menu, if any; transient UI state. */
  iconMenu: DesktopIconMenu | null;
  /** Right click on an icon: selects it and opens its menu at the pointer. */
  openIconMenu: (id: string, position: MenuPosition) => void;
  closeIconMenu: () => void;
  windows: WindowState[];
  activeId: string | null;
  startMenuOpen: boolean;
  setStartMenuOpen: (open: boolean) => void;
  shutdownScreen: boolean;
  wakeUp: () => void;
  onTaskbarButton: (id: string) => void;
  /** Opens a Fuse game in a window (or focuses its window if it is already open). */
  openFuseGame: (gameId: string) => void;
  /** Opens Start > Programs > Accessories > Change desktop background (or focuses it if already open). */
  openWallpaper: () => void;
  openPaint: () => void;
  /** Opens Winamp (or focuses it if already open). */
  openWinamp: () => void;
  openControlPanel: () => void;
  /** Opens Fusteam, the game launcher (or focuses it if already open). */
  openLauncher: () => void;
  wallpaper: string | undefined;
  /** The solid background colour behind the wallpaper (or in place of it when none is set). */
  backgroundColor: string;
  /** Desktop icon grid spacing in pixels. */
  iconSpacingX: number;
  iconSpacingY: number;
};

export function useDesktopViewModel(): DesktopViewModel {
  const { state } = useAppState();
  const ui = useContext(DesktopUiContext);
  const commands = useWindowCommands();
  const games = useContext(FuseGamesContext);
  const launcher = useFuseGameLauncher();
  // Re-renders the icons when the Games applet changes where games open (the shortcut arrow on the tiles).
  const { launch } = useGameLaunch();
  const openLauncher = useOpenLauncher();

  // A window here (focused rather than duplicated) or a browser tab, as the Games applet says.
  const openFuseGame = launcher.launch;
  // Single-instance windows (Winamp, the wallpaper picker, Fusteam) are the reducer's business: `open` focuses an existing one.
  const openWallpaper = useCallback(
    () => commands.open({ kind: "wallpaper" }),
    [commands],
  );
  const openPaint = useCallback(
    () => commands.open({ kind: "paint" }),
    [commands],
  );
  const openWinamp = useCallback(
    () => commands.open({ kind: "winamp" }),
    [commands],
  );
  const openControlPanel = useCallback(
    () => commands.open({ kind: "controlpanel", applet: "home" }),
    [commands],
  );

  const icons: DesktopIconModel[] = [
    {
      id: "fusteam",
      label: LAUNCHER_TITLE,
      icon: "fusteam",
      open: openLauncher,
    },
    {
      id: "my-computer",
      label: "My Computer",
      icon: "computer",
      open: () => commands.open({ kind: "explorer", location: MY_COMPUTER }),
    },
    ...games.games.map((game) => ({
      id: `game:${game.id}`,
      label: game.name,
      icon:
        games.icon(game) ??
        ({ kind: "tile", mark: game.mark, accent: game.accent } as const),
      shortcut: launch === "tab",
      open: () => openFuseGame(game.id),
    })),
    { id: "paint", label: "Paint", icon: "paint", open: openPaint },
    { id: "winamp", label: "Winamp", icon: "winamp", open: openWinamp },
    {
      id: "mirc",
      label: "mIRC",
      icon: "mirc",
      open: () => commands.open({ kind: "mirc" }),
    },
    {
      id: "control-panel",
      label: "Control Panel",
      icon: "settings",
      open: openControlPanel,
    },
  ];

  const activeId = activeWindowId(state);
  const onTaskbarButton = useCallback(
    (id: string) => {
      if (id === activeId) commands.minimize(id);
      else commands.focus(id);
    },
    [activeId, commands],
  );

  return {
    icons,
    selectedIcon: ui.selectedIcon,
    selectIcon: ui.setSelectedIcon,
    iconMenu: ui.iconMenu,
    openIconMenu: (id: string, position: MenuPosition) => {
      ui.setSelectedIcon(id);
      ui.setIconMenu({ iconId: id, position });
    },
    closeIconMenu: () => ui.setIconMenu(null),
    windows: state.windows,
    activeId,
    startMenuOpen: ui.startMenuOpen,
    setStartMenuOpen: ui.setStartMenuOpen,
    shutdownScreen: ui.shutdownScreen,
    wakeUp: () => ui.setShutdownScreen(false),
    onTaskbarButton,
    openFuseGame,
    openWallpaper,
    openPaint,
    openWinamp,
    openControlPanel,
    openLauncher,
    wallpaper: ui.wallpaper,
    backgroundColor: ui.backgroundColor,
    iconSpacingX: ui.iconSpacingX,
    iconSpacingY: ui.iconSpacingY,
  };
}
