// Match bookkeeping: first to N round wins. Rounds get their own seeds derived from the match seed.

import { hashSeed } from "./rng.js";
import { MAX_PLAYERS, MIN_PLAYERS, type Tuning } from "./tuning.js";
import type { RoundConfig, RoundResult } from "./types.js";

export interface MatchConfig {
  seed: number;
  playerCount: number;
  /** Round wins needed to take the match (default 3). */
  winsToWin?: number;
  tuning?: Partial<Tuning>;
}

export interface MatchState {
  readonly config: MatchConfig;
  readonly winsToWin: number;
  /** Round wins per player. */
  wins: number[];
  /** Results of finished rounds, in order. */
  history: RoundResult[];
  /** Match winner once someone reaches `winsToWin`, otherwise null. */
  winner: number | null;
}

export function createMatch(config: MatchConfig): MatchState {
  const n = config.playerCount;
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new RangeError(
      `playerCount must be an integer in ${MIN_PLAYERS}..${MAX_PLAYERS}`,
    );
  }
  const winsToWin = config.winsToWin ?? 3;
  if (!Number.isInteger(winsToWin) || winsToWin < 1)
    throw new RangeError("winsToWin must be >= 1");
  return {
    config,
    winsToWin,
    wins: new Array<number>(n).fill(0),
    history: [],
    winner: null,
  };
}

/** Config for the next round of the match (pass it to `createRound`). */
export function nextRoundConfig(match: MatchState): RoundConfig {
  const config: RoundConfig = {
    seed: hashSeed(match.config.seed, match.history.length + 1),
    playerCount: match.config.playerCount,
  };
  if (match.config.tuning) config.tuning = match.config.tuning;
  return config;
}

/** Records a finished round. Draws count for nobody. Returns the match winner, if decided. */
export function recordRoundResult(
  match: MatchState,
  result: RoundResult,
): number | null {
  if (match.winner !== null) return match.winner;
  match.history.push(result);
  if (result.winner !== null) {
    const wins = (match.wins[result.winner] ?? 0) + 1;
    match.wins[result.winner] = wins;
    if (wins >= match.winsToWin) match.winner = result.winner;
  }
  return match.winner;
}
