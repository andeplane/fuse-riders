import type { AppState } from "../state/appState";
import { appStateReducer } from "../state/appState";
import type { StateStore } from "../state/stateStore";
import type { Size } from "../windows/windowManager";

import { LAUNCHER_WINDOW_ID, shouldMaximizeLauncher } from "./launcherFacts";

/**
 * The state as the desktop boots it: the one launcher window on top, restored, not minimized. A stored launcher
 * (by kind, whatever id a `?open=fusteam` link once gave it) keeps its size state; a new one opens maximized on a
 * display it would not fit. The reducer's own `open` does both.
 */
export function withLauncherOnTop(state: AppState, viewport: Size): AppState {
  return appStateReducer(state, {
    type: "open",
    content: { kind: "launcher" },
    options: {
      id: LAUNCHER_WINDOW_ID,
      maximized: shouldMaximizeLauncher(viewport),
    },
  });
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
