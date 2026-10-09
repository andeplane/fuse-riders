import {
  createBot,
  type BotDifficulty,
  type RoundView,
} from "../engine/index.js";

/**
 * A bot plays one player slot with the same one button a human has: called once per engine step with the
 * read-only view, it returns whether its button goes down on that step.
 */
export type Bot = (view: RoundView, playerId: number) => boolean;

/**
 * The engine's bot (`createBot`) for one slot, adapted to the runner's `Bot` shape. It keeps its memory across the
 * rounds of a match, so make one per slot per match.
 */
export function createBotPlayer(
  difficulty: BotDifficulty,
  playerId: number,
  seed: number,
): Bot {
  const bot = createBot({ difficulty, playerId, seed });
  return (view) => bot(view);
}
