import { useCallback, useContext } from "react";

import type { WindowCommands } from "../windows/useWindowCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import type { Size } from "../windows/windowManager";
import { WindowManagerContext } from "../windows/windowManagerContext";

import { LAUNCHER_WINDOW_ID, shouldMaximizeLauncher } from "./launcherFacts";

/**
 * Opens the launcher, or focuses it when it is already open: the reducer keeps the launcher to one window
 * (`sameInstance`), whatever id a stored one carries. A new one opens maximized on a display it would not fit.
 */
export function openLauncher(commands: WindowCommands, viewport: Size): void {
  commands.open(
    { kind: "launcher" },
    { id: LAUNCHER_WINDOW_ID, maximized: shouldMaximizeLauncher(viewport) },
  );
}

/** `openLauncher` for the desktop icon, over the live window commands and viewport. */
export function useOpenLauncher(): () => void {
  const commands = useWindowCommands();
  const { viewport } = useContext(WindowManagerContext);
  return useCallback(
    () => openLauncher(commands, viewport),
    [commands, viewport],
  );
}
