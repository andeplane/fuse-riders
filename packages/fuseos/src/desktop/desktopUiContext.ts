import { createContext } from "react";

import type { AssistantOptions } from "../assistant/assistantOptionsStore";
import { DEFAULT_ASSISTANT_OPTIONS } from "../assistant/assistantOptionsStore";
import type {
  AssistantAction,
  AssistantState,
} from "../assistant/assistantState";
import { INITIAL_ASSISTANT_STATE } from "../assistant/assistantState";
import type { MenuPosition } from "../windows/menuPosition";

import type { ColorMode, DesktopArea } from "./displayModes";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_ICON_SPACING_X,
  DEFAULT_ICON_SPACING_Y,
} from "./displayPrefsStore";
import type { WallpaperSource } from "./wallpaperStore";

/** The context menu of a desktop icon. */
export type DesktopIconMenu = { iconId: string; position: MenuPosition };

export type DesktopUi = {
  startMenuOpen: boolean;
  setStartMenuOpen: (open: boolean) => void;
  shutdownScreen: boolean;
  setShutdownScreen: (visible: boolean) => void;
  selectedIcon: string | null;
  setSelectedIcon: (id: string | null) => void;
  iconMenu: DesktopIconMenu | null;
  setIconMenu: (menu: DesktopIconMenu | null) => void;
  /** Data url of the desktop wallpaper, per browser. */
  wallpaper: string | undefined;
  /** Where `wallpaper` came from; 'none' whenever `wallpaper` is undefined. */
  wallpaperSource: WallpaperSource;
  setWallpaper: (dataUrl: string | undefined, source: WallpaperSource) => void;
  /** The solid desktop background colour, an alternative to the wallpaper: picking one clears the other. */
  backgroundColor: string;
  setBackgroundColor: (hex: string) => void;
  /** Desktop icon grid spacing in pixels, already clamped so icons can never overlap or fly off screen. */
  iconSpacingX: number;
  iconSpacingY: number;
  setIconSpacing: (spacing: { x: number; y: number }) => void;
  /** The Windows 98 "Large fonts" chrome scale. */
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
  desktopArea: DesktopArea;
  setDesktopArea: (area: DesktopArea) => void;
  largeFonts: boolean;
  setLargeFonts: (large: boolean) => void;
  /** What the Office Assistant says and plays; transient (whether it is hidden lives in AppState). */
  assistant: AssistantState;
  assistantDispatch: (action: AssistantAction) => void;
  /** The assistant's Options, per browser. */
  assistantOptions: AssistantOptions;
  setAssistantOptions: (patch: Partial<AssistantOptions>) => void;
  /** The speech balloon is open. */
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  /** The assistant's right click menu, at the pointer. */
  assistantMenu: MenuPosition | null;
  setAssistantMenu: (position: MenuPosition | null) => void;
};

export const DesktopUiContext = createContext<DesktopUi>({
  startMenuOpen: false,
  setStartMenuOpen: () => undefined,
  shutdownScreen: false,
  setShutdownScreen: () => undefined,
  selectedIcon: null,
  setSelectedIcon: () => undefined,
  iconMenu: null,
  setIconMenu: () => undefined,
  wallpaper: undefined,
  wallpaperSource: "none",
  setWallpaper: () => undefined,
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  setBackgroundColor: () => undefined,
  iconSpacingX: DEFAULT_ICON_SPACING_X,
  iconSpacingY: DEFAULT_ICON_SPACING_Y,
  setIconSpacing: () => undefined,
  colorMode: "true-color",
  setColorMode: () => undefined,
  desktopArea: "current",
  setDesktopArea: () => undefined,
  largeFonts: false,
  setLargeFonts: () => undefined,
  assistant: INITIAL_ASSISTANT_STATE,
  assistantDispatch: () => undefined,
  assistantOptions: DEFAULT_ASSISTANT_OPTIONS,
  setAssistantOptions: () => undefined,
  assistantOpen: false,
  setAssistantOpen: () => undefined,
  assistantMenu: null,
  setAssistantMenu: () => undefined,
});
