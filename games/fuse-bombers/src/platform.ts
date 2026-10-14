import { RESERVED_KEYS, type GameRegistration } from "fuse-platform";

/** Room admission only: Fuse Bombers' first online version reports no results and credits no progression. */
export const bombersRegistration: GameRegistration = {
  id: "fuse-bombers",
  isBot: () => false,
  parseStats: () => undefined,
  emptyTotals: () => ({}),
  credit: () => undefined,
  addTotals: () => {},
  parseTotals: (raw) =>
    Object.keys(raw).every((key) => RESERVED_KEYS.has(key)) ? {} : undefined,
};
