import { useCallback } from "react";

import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

/**
 * Opens a file in Notepad++: a new tab in the open window (brought to the front), or a new window.
 * One Notepad++ per desktop, as the real one defaults to.
 */
export function useOpenInNotepad(): (path: string) => void {
  const { state, dispatch } = useAppState();
  const commands = useWindowCommands();
  return useCallback(
    (path: string) => {
      const existing = state.windows.find(
        (window) => window.kind === "notepadpp",
      );
      if (!existing) {
        commands.open({ kind: "notepadpp", paths: [path], activePath: path });
        return;
      }
      dispatch({
        type: "patch",
        id: existing.id,
        patch: (window) =>
          window.kind === "notepadpp"
            ? {
                ...window,
                paths: window.paths.includes(path)
                  ? window.paths
                  : [...window.paths, path],
                activePath: path,
              }
            : window,
      });
      commands.focus(existing.id);
    },
    [state.windows, dispatch, commands],
  );
}
