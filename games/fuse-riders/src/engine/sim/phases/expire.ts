import type { TickContext } from "../context.js";

/** Portal pairs, black holes and blast marks whose time is up leave the board, whatever the game phase. */
export function expire({ state }: TickContext): void {
  state.portalPairs = state.portalPairs.filter(
    (pair) => state.tick < pair.expiresAtTick,
  );
  state.gravityFields = state.gravityFields.filter(
    (field) => state.tick < field.expiresAtTick,
  );
  state.blasts = state.blasts.filter(
    (blast) => blast.expiresAtTick > state.tick,
  );
}
