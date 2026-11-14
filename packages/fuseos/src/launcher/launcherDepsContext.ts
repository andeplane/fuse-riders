import { createContext } from "react";

import type { LastPlayedStore } from "./lastPlayedStore";
import { LocalStorageLastPlayedStore } from "./lastPlayedStore";

/**
 * What the launcher needs from the browser; the desktop's own deps (clock, new tabs) come from `DesktopDepsContext`,
 * and where a game opens from `LaunchDeviceContext`.
 */
export type LauncherDeps = {
  lastPlayed: LastPlayedStore;
};

export const defaultLauncherDeps: LauncherDeps = {
  lastPlayed: new LocalStorageLastPlayedStore(),
};

export const LauncherDepsContext =
  createContext<LauncherDeps>(defaultLauncherDeps);
