import { useCallback } from "react";

import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

/** Opens the Recycle Bin window, or brings the open one to the front: there is only ever one bin. */
export function useOpenRecycleBin(): () => void {
  const { state } = useAppState();
  const commands = useWindowCommands();
  return useCallback(() => {
    const existing = state.windows.find(
      (window) => window.kind === "recyclebin",
    );
    if (existing) commands.focus(existing.id);
    else commands.open({ kind: "recyclebin" });
  }, [state.windows, commands]);
}
