import {
  createBot,
  FIRE,
  type BotDifficulty,
  type RoundView,
} from "../engine/index.js";

/**
 * A bot plays one player slot with the same input a human has: called once per engine step with the read-only view,
 * it returns the bits it holds on that step (`UP` … `FIRE`; the round fires on the rising edge of `FIRE`).
 */
export type Bot = (view: RoundView, playerId: number) => number;

/**
 * The engine's bot (`createBot`) for one slot, adapted to the runner's `Bot` shape: it holds `FIRE` on the step it
 * presses and steers nothing yet (it only presses when loaded, so each press is a fresh rising edge). It keeps its
 * memory across the rounds of a match, so make one per slot per match.
 */
export function createBotPlayer(
  difficulty: BotDifficulty,
  playerId: number,
  seed: number,
): Bot {
  const bot = createBot({ difficulty, playerId, seed });
  return (view) => (bot(view) ? FIRE : 0);
}
