import type { GameRegistration } from "fuse-platform";
/** Phase 1 is explicitly unranked. Register admission, but refuse every statistics report. */
export const ballBrosRegistration: GameRegistration = {
  id: "ball-bros",
  isBot: (id) => /^bot-[1-9][0-9]*$/.test(id),
  parseStats: () => undefined,
  emptyTotals: () => ({}),
  credit: () => undefined,
  addTotals: () => {},
  parseTotals: () => ({}),
};
