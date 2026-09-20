import {
  MAX_MATCH_PARTICIPANTS,
  type GameRegistration,
  type PlayerResult,
} from "fuse-platform";
import {
  CAPACITY,
  MAX_POINTS,
  MAX_ROUNDS,
  isBotId,
  validName,
} from "./game/basics.js";

/**
 * The fuseDrivers game's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a
 * confirmed match adds to an account. The room service registers it beside Fuse Riders' (`games/fuse-riders/src/platform.ts`) in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never loads
 * the netcode.
 */

/** One player's result as the platform stores it; `FuseDriversPlayerResult` in `game/result.ts` is the same shape. */
export interface FuseDriversStats extends PlayerResult {
  points: number;
  rolls: number;
  holds: number;
  busts: number;
  bestTurn: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "roundWins",
  "points",
  "rolls",
  "holds",
  "busts",
  "bestTurn",
] as const;
export type FuseDriversTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
/** An account's standing in the fuseDrivers game beside its rating. */
export interface FuseDriversTotals {
  totals: FuseDriversTotalsRecord;
}

/** A forged report can only inflate the reporter's own totals, and by at most this much per match. */
const MAX_EVENTS = 20_000;
const KEYS = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
  "points",
  "rolls",
  "holds",
  "busts",
  "bestTurn",
] as const satisfies readonly (keyof FuseDriversStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
const COUNTERS = KEYS.slice(2) as readonly Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The storage and wire boundary for one player: every field checked, unknown ones refused, rebuilt in one key order. */
export function parseFuseDriversStats(
  raw: unknown,
  rounds: number,
): FuseDriversStats | undefined {
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
    // Round wins for a match; the points banked for a round receipt.
    matchScoreUnits: MAX_POINTS * MAX_ROUNDS,
    matchPlacement: MAX_MATCH_PARTICIPANTS,
    earlyExits: 1,
    points: MAX_POINTS * MAX_ROUNDS,
    rolls: MAX_EVENTS,
    holds: MAX_EVENTS,
    busts: MAX_EVENTS,
    bestTurn: MAX_POINTS,
  };
  if (!COUNTERS.every((key) => count(raw[key], most[key]))) return;
  if ((raw.matchPlacement as number) < 1) return;
  if ((raw.busts as number) > (raw.rolls as number)) return;
  const player: Record<string, unknown> = {};
  for (const key of KEYS) player[key] = raw[key];
  return player as unknown as FuseDriversStats;
}

export const emptyFuseDriversTotals = (): FuseDriversTotalsRecord =>
  Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0])) as FuseDriversTotalsRecord;

export const fuseDriversRegistration: GameRegistration<
  FuseDriversStats,
  FuseDriversTotals,
  FuseDriversTotalsRecord
> = {
  id: "fuse-drivers",
  isBot: isBotId,
  parseStats: parseFuseDriversStats,
  emptyTotals: () => ({ totals: emptyFuseDriversTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    roundWins: player.roundWins,
    points: player.points,
    rolls: player.rolls,
    holds: player.holds,
    busts: player.busts,
    bestTurn: player.bestTurn,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS)
      standing.totals[key] =
        key === "bestTurn"
          ? Math.max(standing.totals[key], credit[key])
          : standing.totals[key] + credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined) return { totals: emptyFuseDriversTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFuseDriversTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
