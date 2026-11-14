import { useCallback, useContext } from "react";

import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";
import { WindowManagerContext } from "../windows/windowManagerContext";

import { LAUNCHER_WINDOW_ID, shouldMaximizeLauncher } from "./launcherFacts";

/** Opens the launcher from the desktop icon or the Start menu, or focuses it when it is already open. */
export function useOpenLauncher(): () => void {
  const { state } = useAppState();
  const commands = useWindowCommands();
  const { viewport } = useContext(WindowManagerContext);
  // By kind, not id: a `?open=fusteam` deep link opens one under a generated id.
  const existing = state.windows.find((window) => window.kind === "launcher");
  const existingId = existing?.id;
  return useCallback(() => {
    if (existingId !== undefined) {
      commands.focus(existingId);
      return;
    }
    commands.open({ kind: "launcher" }, LAUNCHER_WINDOW_ID);
    if (shouldMaximizeLauncher(viewport))
      commands.toggleMaximize(LAUNCHER_WINDOW_ID);
  }, [existingId, commands, viewport]);
}
