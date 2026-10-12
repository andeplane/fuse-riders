import {
  MAX_MATCH_PARTICIPANTS,
  type GameRegistration,
  type PlayerResult,
} from "fuse-platform";
import {
  CAPACITY,
  MAX_NET_WORTH,
  MAX_WEEKS,
  isBotId,
  validName,
} from "./game/basics.js";

/**
 * Fuse Lane's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it in `service/history.ts`. It imports only `basics.ts`, so
 * the service never loads the netcode or the rules.
 */
export interface FuseLaneStats extends PlayerResult {
  /** The week they won in, or how many weeks they played. */
  weeks: number;
  netWorth: number;
  degrees: number;
  shifts: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "fastestWin",
  "bestNetWorth",
  "degrees",
  "shifts",
] as const;
export type FuseLaneTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
export interface FuseLaneTotals {
  totals: FuseLaneTotalsRecord;
}

const KEYS = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
  "weeks",
  "netWorth",
  "degrees",
  "shifts",
] as const satisfies readonly (keyof FuseLaneStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
const COUNTERS = KEYS.slice(2) as readonly Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The storage and wire boundary for one player: every field checked, unknown ones refused, rebuilt in one key order. */
export function parseFuseLaneStats(
  raw: unknown,
  rounds: number,
): FuseLaneStats | undefined {
  if (!plain(raw)) return;
  const keys = Object.keys(raw);
  if (
    keys.length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(raw, key))
  )
    return;
  const { playerId, name } = raw;
  if (
    typeof playerId !== "string" ||
    !(/^[a-f0-9]{24}$/.test(playerId) || isBotId(playerId)) ||
    !validName(name)
  )
    return;
  const most: Record<Counter, number> = {
    slot: CAPACITY - 1,
    roundsPlayed: rounds,
    roundWins: rounds,
    matchScoreUnits: 100,
    matchPlacement: MAX_MATCH_PARTICIPANTS,
    earlyExits: 1,
    weeks: MAX_WEEKS + 2,
    netWorth: MAX_NET_WORTH,
    degrees: 11,
    shifts: 10 * (MAX_WEEKS + 2),
  };
  if (!COUNTERS.every((key) => count(raw[key], most[key]))) return;
  if ((raw.matchPlacement as number) < 1 || (raw.weeks as number) < 1) return;
  const player: Record<string, unknown> = {};
  for (const key of KEYS) player[key] = raw[key];
  return player as unknown as FuseLaneStats;
}

export const emptyFuseLaneTotals = (): FuseLaneTotalsRecord =>
  Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0])) as FuseLaneTotalsRecord;

export const fuseLaneRegistration: GameRegistration<
  FuseLaneStats,
  FuseLaneTotals,
  FuseLaneTotalsRecord
> = {
  id: "fuse-lane",
  isBot: isBotId,
  parseStats: parseFuseLaneStats,
  emptyTotals: () => ({ totals: emptyFuseLaneTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.roundWins > 0 ? 1 : 0,
    fastestWin: player.roundWins > 0 ? player.weeks : 0,
    bestNetWorth: player.netWorth,
    degrees: player.degrees,
    shifts: player.shifts,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) {
      const now = standing.totals[key],
        add = credit[key];
      if (key === "bestNetWorth") standing.totals[key] = Math.max(now, add);
      else if (key === "fastestWin")
        standing.totals[key] =
          add === 0 ? now : now === 0 ? add : Math.min(now, add);
      else standing.totals[key] = now + add;
    }
  },
  parseTotals(document) {
    if (document.totals === undefined) return { totals: emptyFuseLaneTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFuseLaneTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
