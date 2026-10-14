import { RESERVED_KEYS, type GameRegistration } from "fuse-platform";
/** POC room admission through the shared platform; persistent careers are deferred. */
export const graveyardRegistration: GameRegistration = {
  id: "graveyard-shift",
  isBot: (id) => /^bot:[0-9]+$/.test(id),
  parseStats: () => undefined,
  emptyTotals: () => ({}),
  credit: () => undefined,
  addTotals: () => {},
  parseTotals: (raw) =>
    Object.keys(raw).every((k) => RESERVED_KEYS.has(k)) ? {} : undefined,
};
