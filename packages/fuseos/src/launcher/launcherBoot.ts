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
 * The state as the desktop boots it: Winamp open (frameless, its playlist loaded, nothing playing until someone
 * presses play) with the launcher on top of it and focused. Both are single-instance programs, so a Winamp or a
 * launcher the stored desktop already holds is brought up rather than doubled, and a `?open=winamp` on top of
 * this only focuses it. A display the launcher fills (a phone) boots without Winamp: it would sit unseen behind
 * the launcher and cost the player's download for nothing.
 */
export function withBootWindows(state: AppState, viewport: Size): AppState {
  const withWinamp = shouldMaximizeLauncher(viewport)
    ? state
    : appStateReducer(state, { type: "open", content: { kind: "winamp" } });
  return withLauncherOnTop(withWinamp, viewport);
}

/**
 * Wraps the desktop's store so every boot loads with Winamp open and the launcher focused above it (`?open=`
 * windows are opened on top of what this returns). Saves pass straight through.
 */
export function withLauncherOnBoot(
  store: StateStore,
  viewport: () => Size,
): StateStore {
  return {
    load: () => withBootWindows(store.load(), viewport()),
    save: (state) => store.save(state),
  };
}
