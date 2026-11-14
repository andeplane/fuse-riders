import type { ReactNode } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";

import type { AssistantOptions } from "../assistant/assistantOptionsStore";
import { AssistantOptionsStoreContext } from "../assistant/assistantOptionsStore";
import {
  INITIAL_ASSISTANT_STATE,
  assistantReducer,
} from "../assistant/assistantState";
import type { MenuPosition } from "../windows/menuPosition";

import type { DesktopIconMenu } from "./desktopUiContext";
import { DesktopUiContext } from "./desktopUiContext";
import type { ColorMode, DesktopArea } from "./displayModes";
import type { DisplayPrefs } from "./displayPrefsStore";
import {
  DEFAULT_BACKGROUND_COLOR,
  DisplayPrefsStoreContext,
  clampIconSpacing,
} from "./displayPrefsStore";
import type { WallpaperSource } from "./wallpaperStore";
import { WallpaperStoreContext } from "./wallpaperStore";

/** Transient desktop UI state: menu open, shutdown overlay, icon selection, what the Office Assistant says. Never persisted. */
export function DesktopUiProvider({ children }: { children: ReactNode }) {
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [shutdownScreen, setShutdownScreen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [iconMenu, setIconMenu] = useState<DesktopIconMenu | null>(null);
  const store = useContext(WallpaperStoreContext);
  const [wallpaper, setWallpaperState] = useState<string | undefined>(() =>
    store.get(),
  );
  // The source is not persisted; a wallpaper restored from storage is reported as 'file'.
  const [wallpaperSource, setWallpaperSource] = useState<WallpaperSource>(() =>
    store.get() ? "file" : "none",
  );

  const displayStore = useContext(DisplayPrefsStoreContext);
  const [displayPrefs, setDisplayPrefsState] = useState<DisplayPrefs>(() =>
    displayStore.get(),
  );
  const persistDisplayPrefs = useCallback(
    (patch: Partial<DisplayPrefs>) => {
      setDisplayPrefsState((current) => {
        const next = { ...current, ...patch };
        displayStore.set(next);
        return next;
      });
    },
    [displayStore],
  );

  const setWallpaper = useCallback(
    (dataUrl: string | undefined, source: WallpaperSource) => {
      store.set(dataUrl);
      setWallpaperState(dataUrl);
      setWallpaperSource(dataUrl ? source : "none");
      // The wallpaper and the background colour are alternatives, as in the original: picking
      // a wallpaper clears the colour back to the default teal, and vice versa (setBackgroundColor below).
      if (dataUrl)
        persistDisplayPrefs({ backgroundColor: DEFAULT_BACKGROUND_COLOR });
    },
    [store, persistDisplayPrefs],
  );
  const setBackgroundColor = useCallback(
    (hex: string) => {
      store.set(undefined);
      setWallpaperState(undefined);
      setWallpaperSource("none");
      persistDisplayPrefs({ backgroundColor: hex });
    },
    [store, persistDisplayPrefs],
  );
  const setIconSpacing = useCallback(
    (spacing: { x: number; y: number }) =>
      persistDisplayPrefs({
        iconSpacingX: clampIconSpacing(spacing.x),
        iconSpacingY: clampIconSpacing(spacing.y),
      }),
    [persistDisplayPrefs],
  );
  const setColorMode = useCallback(
    (colorMode: ColorMode) => persistDisplayPrefs({ colorMode }),
    [persistDisplayPrefs],
  );
  const setDesktopArea = useCallback(
    (desktopArea: DesktopArea) => persistDisplayPrefs({ desktopArea }),
    [persistDisplayPrefs],
  );
  const setLargeFonts = useCallback(
    (large: boolean) => persistDisplayPrefs({ largeFonts: large }),
    [persistDisplayPrefs],
  );

  // The font scale is a custom property on <html> rather than a class on the desktop's own root,
  // so it also reaches windows and menus that portal straight to document.body (ContextMenu).
  useEffect(() => {
    document.documentElement.classList.toggle(
      "large-fonts",
      displayPrefs.largeFonts,
    );
  }, [displayPrefs.largeFonts]);

  const [assistant, assistantDispatch] = useReducer(
    assistantReducer,
    INITIAL_ASSISTANT_STATE,
  );
  const optionsStore = useContext(AssistantOptionsStoreContext);
  const [assistantOptions, setAssistantOptionsState] =
    useState<AssistantOptions>(() => optionsStore.get());
  const setAssistantOptions = useCallback(
    (patch: Partial<AssistantOptions>) => {
      setAssistantOptionsState((current) => {
        const next = { ...current, ...patch };
        optionsStore.set(next);
        return next;
      });
    },
    [optionsStore],
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMenu, setAssistantMenu] = useState<MenuPosition | null>(null);

  const value = useMemo(
    () => ({
      startMenuOpen,
      setStartMenuOpen,
      shutdownScreen,
      setShutdownScreen,
      selectedIcon,
      setSelectedIcon,
      iconMenu,
      setIconMenu,
      wallpaper,
      wallpaperSource,
      setWallpaper,
      backgroundColor: displayPrefs.backgroundColor,
      setBackgroundColor,
      iconSpacingX: displayPrefs.iconSpacingX,
      iconSpacingY: displayPrefs.iconSpacingY,
      setIconSpacing,
      colorMode: displayPrefs.colorMode ?? "true-color",
      setColorMode,
      desktopArea: displayPrefs.desktopArea ?? "current",
      setDesktopArea,
      largeFonts: displayPrefs.largeFonts,
      setLargeFonts,
      assistant,
      assistantDispatch,
      assistantOptions,
      setAssistantOptions,
      assistantOpen,
      setAssistantOpen,
      assistantMenu,
      setAssistantMenu,
    }),
    [
      startMenuOpen,
      shutdownScreen,
      selectedIcon,
      iconMenu,
      wallpaper,
      wallpaperSource,
      setWallpaper,
      displayPrefs,
      setBackgroundColor,
      setIconSpacing,
      setLargeFonts,
      setColorMode,
      setDesktopArea,
      assistant,
      assistantOptions,
      setAssistantOptions,
      assistantOpen,
      assistantMenu,
    ],
  );
  return (
    <DesktopUiContext.Provider value={value}>
      {children}
    </DesktopUiContext.Provider>
  );
}
