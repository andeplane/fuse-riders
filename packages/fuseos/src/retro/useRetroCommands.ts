import { useCallback, useMemo } from "react";

import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { GameId } from "./gameIds";

export type RetroCommands = {
  /** Opens a retro game in a window of its own, or brings its window to the front when it is already open. */
  openGame: (game: GameId) => void;
  /** Opens the Retro Games folder window, or brings it to the front when it is already open. */
  openFolder: () => void;
};

/** Window commands for Programs > Games > Retro Games: one window per game and one folder, never duplicated. */
export function useRetroCommands(): RetroCommands {
  const { state } = useAppState();
  const commands = useWindowCommands();
  const openGame = useCallback(
    (game: GameId) => {
      const existing = state.windows.find(
        (window) => window.kind === "retro" && window.game === game,
      );
      if (existing) commands.focus(existing.id);
      else commands.open({ kind: "retro", game });
    },
    [state.windows, commands],
  );
  const openFolder = useCallback(() => {
    const existing = state.windows.find(
      (window) => window.kind === "retroFolder",
    );
    if (existing) commands.focus(existing.id);
    else commands.open({ kind: "retroFolder" });
  }, [state.windows, commands]);
  return useMemo(() => ({ openGame, openFolder }), [openGame, openFolder]);
}
