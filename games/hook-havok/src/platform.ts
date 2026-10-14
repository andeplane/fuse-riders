import { RESERVED_KEYS, type GameRegistration } from "fuse-platform";
/** Room admission only. This experiment cannot report results or credit progression. */
export const hookRegistration: GameRegistration = {
  id: "hook-havok",
  isBot: () => false,
  parseStats: () => undefined,
  emptyTotals: () => ({}),
  credit: () => undefined,
  addTotals: () => {},
  parseTotals: (raw) =>
    Object.keys(raw).every((key) => RESERVED_KEYS.has(key)) ? {} : undefined,
};
