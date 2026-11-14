import { useCallback, useMemo } from "react";

import { useWindowCommands } from "../windows/useWindowCommands";

import type { GameId } from "./gameIds";

export type RetroCommands = {
  /** Opens a retro game in a window of its own, or brings its window to the front when it is already open. */
  openGame: (game: GameId) => void;
  /** Opens the Retro Games folder window, or brings it to the front when it is already open. */
  openFolder: () => void;
};

/** Window commands for Programs > Games > Retro Games: one window per game and one folder (the reducer's single-instance rule). */
export function useRetroCommands(): RetroCommands {
  const commands = useWindowCommands();
  const openGame = useCallback(
    (game: GameId) => commands.open({ kind: "retro", game }),
    [commands],
  );
  const openFolder = useCallback(
    () => commands.open({ kind: "retroFolder" }),
    [commands],
  );
  return useMemo(() => ({ openGame, openFolder }), [openGame, openFolder]);
}
