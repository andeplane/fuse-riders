import { createContext } from "react";

import type { LastPlayedStore } from "./lastPlayedStore";
import { LocalStorageLastPlayedStore } from "./lastPlayedStore";

/**
 * What the launcher needs from the browser: the clock comes from `DesktopDepsContext`, and where a game opens
 * (a window here or a browser tab) is `useFuseGameLauncher`'s, from the Games applet's choice and `LaunchDeviceContext`.
 */
export type LauncherDeps = {
  lastPlayed: LastPlayedStore;
};

export const defaultLauncherDeps: LauncherDeps = {
  lastPlayed: new LocalStorageLastPlayedStore(),
};

export const LauncherDepsContext =
  createContext<LauncherDeps>(defaultLauncherDeps);
