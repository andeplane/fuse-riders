import { useContext, useEffect, useMemo, useReducer } from 'react';

import { GamesDepsContext } from '../gamesDepsContext';

import type { Location, SolitaireOptions, SolitaireState } from './solitaireRules';
import { DEFAULT_OPTIONS, deal, scoreText, solitaireReducer } from './solitaireRules';

export type SolitaireGame = {
  state: SolitaireState;
  score: string;
  time: string;
  deal: () => void;
  draw: () => void;
  move: (from: Location, count: number, to: Location) => void;
  autoMove: (from: Location) => void;
  undo: () => void;
  setOptions: (options: SolitaireOptions) => void;
  setCardBack: (cardBack: number) => void;
};

/**
 * One game of Solitaire, transient like a Minesweeper board: it lives with
 * the window and is not host synced. Called once per Solitaire window.
 * Shuffling and the clock come from GamesDeps; `initial` lets tests deal a
 * known table.
 */
export function useSolitaireGame(initial?: SolitaireState): SolitaireGame {
  const deps = useContext(GamesDepsContext);
  const [state, dispatch] = useReducer(solitaireReducer, initial, (seed) => seed ?? deal(DEFAULT_OPTIONS, deps.random));

  const ticking = state.status === 'playing' && state.options.timed;
  useEffect(() => {
    if (!ticking) return undefined;
    return deps.subscribeSeconds(() => dispatch({ type: 'tick', now: deps.now() }));
  }, [ticking, deps]);

  return useMemo(
    () => ({
      state,
      score: scoreText(state),
      time: String(state.elapsed),
      deal: () => dispatch({ type: 'deal', random: deps.random }),
      draw: () => dispatch({ type: 'draw', now: deps.now() }),
      move: (from: Location, count: number, to: Location) => dispatch({ type: 'move', from, count, to, now: deps.now() }),
      autoMove: (from: Location) => dispatch({ type: 'autoMove', from, now: deps.now() }),
      undo: () => dispatch({ type: 'undo' }),
      setOptions: (options: SolitaireOptions) => dispatch({ type: 'setOptions', options, random: deps.random }),
      setCardBack: (cardBack: number) => dispatch({ type: 'setCardBack', cardBack }),
    }),
    [state, deps]
  );
}
