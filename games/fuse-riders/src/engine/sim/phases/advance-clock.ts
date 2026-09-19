import type { TickContext } from "../context.js";

/** The tick this step simulates. Everything after reads `state.tick` as "now". */
export function advanceClock({ state }: TickContext): void {
  state.tick += 1;
}
