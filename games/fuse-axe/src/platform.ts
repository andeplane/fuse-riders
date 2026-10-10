import { RESERVED_KEYS, type GameRegistration } from "fuse-platform";

/** Room admission only: this first version reports no results and credits no progression. */
export const axeRegistration: GameRegistration = {
  id: "fuse-axe",
  isBot: () => false,
  parseStats: () => undefined,
  emptyTotals: () => ({}),
  credit: () => undefined,
  addTotals: () => {},
  parseTotals: (raw) =>
    Object.keys(raw).every((key) => RESERVED_KEYS.has(key)) ? {} : undefined,
};
