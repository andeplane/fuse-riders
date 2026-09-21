import {
  ARENA,
  CORE,
  PADDLE,
  PADDLE_HALF,
  PADDLE_THICK,
  BALL_RADIUS,
  COUNTDOWN,
  LIMIT,
  type ArenaState,
} from "./state.js";
export type { ArenaState, Impact } from "./state.js";
export const viewRules = {
  arena: ARENA,
  core: CORE,
  paddle: PADDLE,
  paddleHalf: PADDLE_HALF,
  paddleThick: PADDLE_THICK,
  ballRadius: BALL_RADIUS,
  countdown: COUNTDOWN,
  limit: LIMIT,
};
export interface BallView {
  tick: number;
  matchId: string;
  arena: ArenaState | null;
  rules: typeof viewRules;
}
export function view(
  tick: number,
  matchId: string,
  arena: ArenaState | null,
): BallView {
  return {
    tick,
    matchId,
    arena: arena ? structuredClone(arena) : null,
    rules: viewRules,
  };
}
