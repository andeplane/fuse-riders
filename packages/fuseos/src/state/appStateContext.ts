import type { Dispatch } from "react";
import { createContext } from "react";

import type { AppAction, AppState } from "./appState";
import { DEFAULT_STATE } from "./appState";
import { announcePlaytestGame } from "fuse-ui/playtest-focus";

export type AppStore = { state: AppState; dispatch: Dispatch<AppAction> };

export const AppStateContext = createContext<AppStore>({
  state: DEFAULT_STATE,
  dispatch: () => undefined,
});

export type AppStateDeps = {
  setTimeout: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
  syncDelayMs: number;
  focusedGame(gameId: string): void;
};

export const defaultAppStateDeps: AppStateDeps = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  syncDelayMs: 150,
  focusedGame: (gameId) => announcePlaytestGame(window, gameId),
};

export const AppStateDepsContext =
  createContext<AppStateDeps>(defaultAppStateDeps);
