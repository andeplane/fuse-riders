import type { AppState, WindowState } from "../state/appState";
import { appStateReducer } from "../state/appState";
import type { StateStore } from "../state/stateStore";
import type { Size } from "../windows/windowManager";

import { LAUNCHER_WINDOW_ID, shouldMaximizeLauncher } from "./launcherFacts";

/**
 * The state as the desktop boots it: the one launcher window on top, restored, not minimized. A stored launcher
 * keeps its size state; a new one opens maximized on a display it would not fit.
 */
export function withLauncherOnTop(state: AppState, viewport: Size): AppState {
  // By kind, not id: a launcher a `?open=fusteam` link once opened was stored under a generated id.
  const existing = state.windows.find((window) => window.kind === "launcher");
  if (existing)
    return appStateReducer(state, { type: "focus", id: existing.id });
  const launcher: WindowState = {
    id: LAUNCHER_WINDOW_ID,
    kind: "launcher",
    minimized: false,
    maximized: shouldMaximizeLauncher(viewport),
  };
  return { ...state, windows: [...state.windows, launcher] };
}

/**
 * Wraps the desktop's store so every boot loads with the launcher focused (`?open=` windows are opened on top of
 * what this returns). Saves pass straight through.
 */
export function withLauncherOnBoot(
  store: StateStore,
  viewport: () => Size,
): StateStore {
  return {
    load: () => withLauncherOnTop(store.load(), viewport()),
    save: (state) => store.save(state),
  };
}
