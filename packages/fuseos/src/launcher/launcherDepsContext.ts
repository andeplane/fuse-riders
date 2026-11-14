import { createContext } from "react";

import type { LastPlayedStore } from "./lastPlayedStore";
import { LocalStorageLastPlayedStore } from "./lastPlayedStore";

/** What the launcher needs from the browser; the desktop's own deps (clock, new tabs) come from `DesktopDepsContext`. */
export type LauncherDeps = {
  lastPlayed: LastPlayedStore;
  /** A mouse or trackpad rather than a touch screen: with the launch preference unset, a game opens in a window. */
  finePointer: () => boolean;
};

export const defaultLauncherDeps: LauncherDeps = {
  lastPlayed: new LocalStorageLastPlayedStore(),
  finePointer: () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: fine)").matches
      : true,
};

export const LauncherDepsContext =
  createContext<LauncherDeps>(defaultLauncherDeps);
