import type { GameRegistration, PlayerResult } from "fuse-platform";

interface Totals {
  totals: { matches: number; wins: number };
}
const keys = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
] as const;
const count = (x: unknown, max: number): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
export function parseBirdStats(
  raw: unknown,
  rounds: number,
): PlayerResult | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || rounds !== 1)
    return;
  const p = raw as Record<string, unknown>;
  if (
    Object.keys(p).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(p, k))
  )
    return;
  if (
    typeof p.playerId !== "string" ||
    !/^[a-f0-9]{24}$/.test(p.playerId) ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 48 ||
    /[\u0000-\u001f\u007f]/.test(p.name)
  )
    return;
  if (
    !count(p.slot, 4) ||
    p.roundsPlayed !== 1 ||
    !count(p.roundWins, 1) ||
    !count(p.matchScoreUnits, 100) ||
    !count(p.matchPlacement, 5) ||
    p.matchPlacement < 1 ||
    !count(p.earlyExits, 1)
  )
    return;
  return {
    playerId: p.playerId,
    name: p.name,
    slot: p.slot,
    roundsPlayed: 1,
    roundWins: p.roundWins,
    matchScoreUnits: p.matchScoreUnits,
    matchPlacement: p.matchPlacement,
    earlyExits: p.earlyExits,
  };
}
/** Room registration reuses the shared platform; new career/leaderboard screens are outside Phase 1. */
export const birdsRegistration: GameRegistration<
  PlayerResult,
  Totals,
  Totals["totals"]
> = {
  id: "fuse-birds",
  isBot: () => false,
  parseStats: parseBirdStats,
  emptyTotals: () => ({ totals: { matches: 0, wins: 0 } }),
  credit: (p) => ({ matches: 1, wins: p.roundWins }),
  addTotals: (standing, credit) => {
    standing.totals.matches += credit.matches;
    standing.totals.wins += credit.wins;
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: { matches: 0, wins: 0 } };
    const t = document.totals;
    if (
      !t ||
      typeof t !== "object" ||
      Array.isArray(t) ||
      !("matches" in t) ||
      !("wins" in t) ||
      !count(t.matches, Number.MAX_SAFE_INTEGER) ||
      !count(t.wins, t.matches)
    )
      return;
    return { totals: { matches: t.matches, wins: t.wins } };
  },
};
