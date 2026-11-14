import { useContext, useMemo } from "react";

import type { AssistantOptions } from "../assistant/assistantOptionsStore";
import { DesktopUiContext } from "../desktop/desktopUiContext";
import type { ColorMode, DesktopArea } from "../desktop/displayModes";
import type { WallpaperSource } from "../desktop/wallpaperStore";
import type { ControlPanelApplet, WindowState } from "../state/appState";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { SystemInfo } from "./systemInfo";
import { systemInfo } from "./systemInfo";
import { SystemProbeContext } from "./systemProbeContext";

export type ControlPanelViewModel = {
  applet: ControlPanelApplet;
  /** The tab the window was opened on (Start > Settings > Screen Saver), for an applet with tabs. */
  tab: string | undefined;
  openApplet: (applet: ControlPanelApplet) => void;
  system: SystemInfo;
  wallpaper: string | undefined;
  setWallpaper: (dataUrl: string | undefined, source: WallpaperSource) => void;
  /** The solid background colour, an alternative to the wallpaper: picking one clears the other. */
  backgroundColor: string;
  setBackgroundColor: (hex: string) => void;
  /** Desktop icon grid spacing in pixels, already clamped so icons can never overlap or fly off screen. */
  iconSpacingX: number;
  iconSpacingY: number;
  setIconSpacing: (spacing: { x: number; y: number }) => void;
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
  desktopArea: DesktopArea;
  setDesktopArea: (area: DesktopArea) => void;
  /** The Windows 98 "Large fonts" chrome scale. */
  largeFonts: boolean;
  setLargeFonts: (large: boolean) => void;
  /** The Office Assistant applet: shown/hidden (persisted) and its Options (per browser). */
  assistantShown: boolean;
  setAssistantShown: (shown: boolean) => void;
  assistantOptions: AssistantOptions;
  setAssistantOptions: (patch: Partial<AssistantOptions>) => void;
  close: () => void;
};

function appletOf(window: WindowState | undefined): ControlPanelApplet {
  return window?.kind === "controlpanel" ? window.applet : "home";
}

export function useControlPanelViewModel(
  windowId: string,
): ControlPanelViewModel {
  const { state, dispatch } = useAppState();
  const commands = useWindowCommands();
  const probe = useContext(SystemProbeContext);
  const {
    wallpaper,
    setWallpaper,
    backgroundColor,
    setBackgroundColor,
    iconSpacingX,
    iconSpacingY,
    setIconSpacing,
    colorMode,
    setColorMode,
    desktopArea,
    setDesktopArea,
    largeFonts,
    setLargeFonts,
    assistantOptions,
    setAssistantOptions,
    assistantDispatch,
  } = useContext(DesktopUiContext);
  const window = state.windows.find((window) => window.id === windowId);
  const applet = appletOf(window);
  const tab = window?.kind === "controlpanel" ? window.tab : undefined;
  const system = useMemo(() => systemInfo(probe()), [probe]);

  return {
    applet,
    tab,
    openApplet: (next) =>
      dispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "controlpanel" ? { ...window, applet: next } : window,
      }),
    system,
    wallpaper,
    setWallpaper,
    backgroundColor,
    setBackgroundColor,
    iconSpacingX,
    iconSpacingY,
    setIconSpacing,
    colorMode,
    setColorMode,
    desktopArea,
    setDesktopArea,
    largeFonts,
    setLargeFonts,
    assistantShown: !state.assistantHidden,
    setAssistantShown: (shown) => {
      dispatch({ type: "setAssistantHidden", hidden: !shown });
      if (shown) assistantDispatch({ type: "show" });
    },
    assistantOptions,
    setAssistantOptions,
    close: () => commands.close(windowId),
  };
}
