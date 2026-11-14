import { useCallback, useContext } from "react";

import type { Size } from "../windows/windowManager";
import { clampRect } from "../windows/windowManager";
import { WindowManagerContext } from "../windows/windowManagerContext";

import type { GameId } from "./gameIds";
import { GAMES, gamePage } from "./games";
import { GamesDepsContext } from "./gamesDepsContext";
import { IframeGame } from "../windows/IframeGame";
import { Minesweeper } from "./minesweeper/Minesweeper";
import { Solitaire } from "./solitaire/Solitaire";

export type GameWindowProps = {
  windowId?: string;
  game: GameId;
  active: boolean;
  onActivate: () => void;
};

/** Body of a game window: the game starts as soon as the window opens. */
export function GameWindow({
  windowId,
  game,
  active,
  onActivate,
}: GameWindowProps) {
  const deps = useContext(GamesDepsContext);
  const { fitBoard } = useGameWindowViewModel(windowId);
  const info = GAMES[game];
  const page = gamePage(info);
  if (page === undefined) {
    return game === "solitaire" ? (
      <Solitaire />
    ) : (
      <Minesweeper onBoardSizeChange={fitBoard} />
    );
  }
  return (
    <IframeGame
      name={info.name}
      url={deps.resolveUrl(page)}
      active={active}
      onActivate={onActivate}
    />
  );
}

function useGameWindowViewModel(windowId: string | undefined) {
  const { rectFor, setRect, viewport } = useContext(WindowManagerContext);
  const fitBoard = useCallback(
    (size: Size) => {
      if (!windowId) return;
      const current = rectFor(windowId, 0);
      const desired = clampRect({ ...current, ...size }, viewport);
      if (current.width !== desired.width || current.height !== desired.height)
        setRect(windowId, desired);
    },
    [rectFor, setRect, viewport, windowId],
  );
  return { fitBoard };
}
