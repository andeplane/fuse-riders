import { RESERVED_KEYS, type GameRegistration } from "fuse-platform";

/** Room admission only: Fuse Front's first online version reports no results and credits no progression. */
export const frontRegistration: GameRegistration = {
  id: "fuse-front",
  isBot: () => false,
  parseStats: () => undefined,
  emptyTotals: () => ({}),
  credit: () => undefined,
  addTotals: () => {},
  parseTotals: (raw) =>
    Object.keys(raw).every((key) => RESERVED_KEYS.has(key)) ? {} : undefined,
};
