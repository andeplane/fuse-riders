import { useContext, useEffect, useMemo, useReducer } from "react";

import type { Size } from "../../windows/windowManager";
import { GamesDepsContext } from "../gamesDepsContext";

import type { Difficulty, MinesweeperState } from "./minesweeperRules";
import {
  counterText,
  flagCount,
  initialState,
  minesweeperReducer,
} from "./minesweeperRules";

export type MinesweeperGame = {
  state: MinesweeperState;
  minesLeft: string;
  time: string;
  reveal: (index: number) => void;
  flag: (index: number) => void;
  reset: () => void;
  setDifficulty: (difficulty: Difficulty) => void;
};

/**
 * State of one Minesweeper board. The board is transient (not host synced) and
 * lives with the window, so this hook is called once per Minesweeper window.
 * Timers and randomness come from GamesDeps.
 */
export function useMinesweeperGame(
  difficulty: Difficulty = "beginner",
  onBoardSizeChange?: (size: Size) => void,
): MinesweeperGame {
  const deps = useContext(GamesDepsContext);
  const [state, dispatch] = useReducer(
    minesweeperReducer,
    difficulty,
    initialState,
  );

  useEffect(() => {
    onBoardSizeChange?.({
      width: Math.max(240, state.board.width * 16 + 44),
      height: state.board.height * 16 + 136,
    });
  }, [state.board.width, state.board.height, onBoardSizeChange]);

  const playing = state.status === "playing";
  useEffect(() => {
    if (!playing) return undefined;
    return deps.subscribeSeconds(() =>
      dispatch({ type: "tick", now: deps.now() }),
    );
  }, [playing, deps]);

  return useMemo(
    () => ({
      state,
      minesLeft: counterText(state.board.mines - flagCount(state.board)),
      time: counterText(state.elapsed),
      reveal: (index: number) =>
        dispatch({
          type: "reveal",
          index,
          now: deps.now(),
          random: deps.random,
        }),
      flag: (index: number) => dispatch({ type: "flag", index }),
      reset: () => dispatch({ type: "reset" }),
      setDifficulty: (next: Difficulty) =>
        dispatch({ type: "setDifficulty", difficulty: next }),
    }),
    [state, deps],
  );
}
