import { useCallback, useContext } from "react";

import { FuseGamesContext } from "../fusegames/registry";
import { useFuseGameLauncher } from "../fusegames/useFuseGameLauncher";
import { useGameLaunch } from "../settings/useGameLaunch";
import type { WindowKind, WindowState } from "../state/appState";
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

  // Single-instance windows (Winamp, the wallpaper picker) are focused rather than duplicated:
  // true when an open window matched and was brought to the front.
  const focusExisting = useCallback(
    (
      kind: WindowKind,
      matches: (window: WindowState) => boolean = () => true,
    ) => {
      const existing = state.windows.find(
        (window) => window.kind === kind && matches(window),
      );
      if (!existing) return false;
      commands.focus(existing.id);
      return true;
    },
    [state.windows, commands],
  );
  // A window here (focused rather than duplicated) or a browser tab, as the Games applet says.
  const openFuseGame = launcher.launch;
  const openWallpaper = useCallback(() => {
    if (!focusExisting("wallpaper")) commands.open({ kind: "wallpaper" });
  }, [focusExisting, commands]);
  const openPaint = useCallback(
    () => commands.open({ kind: "paint" }),
    [commands],
  );
  const openWinamp = useCallback(() => {
    if (!focusExisting("winamp")) commands.open({ kind: "winamp" });
  }, [focusExisting, commands]);
  const openControlPanel = useCallback(
    () => commands.open({ kind: "controlpanel", applet: "home" }),
    [commands],
  );

  const icons: DesktopIconModel[] = [
    ...games.games.map((game) => ({
      id: `game:${game.id}`,
      label: game.name,
      icon: {
        kind: "tile",
        mark: game.mark,
        accent: game.accent,
        shortcut: launch === "tab",
      } as const,
      open: () => openFuseGame(game.id),
    })),
    { id: "paint", label: "Paint", icon: "paint", open: openPaint },
    { id: "winamp", label: "Winamp", icon: "winamp", open: openWinamp },
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
    wallpaper: ui.wallpaper,
    backgroundColor: ui.backgroundColor,
    iconSpacingX: ui.iconSpacingX,
    iconSpacingY: ui.iconSpacingY,
  };
}
