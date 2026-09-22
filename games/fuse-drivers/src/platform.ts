import {
  MAX_MATCH_PARTICIPANTS,
  type GameRegistration,
  type PlayerResult,
} from "fuse-platform";
import {
  CAPACITY,
  MAX_EVENTS,
  MAX_LAPS,
  MAX_PROGRESS_UNITS,
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
  laps: number;
  kills: number;
  deaths: number;
  /** Laps this driver crossed the line in front. */
  lapsLed: number;
  nitrosUsed: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "roundWins",
  "laps",
  "kills",
  "deaths",
  "lapsLed",
  "nitrosUsed",
] as const;
export type FuseDriversTotalsRecord = Record<
  (typeof TOTAL_KEYS)[number],
  number
>;
/** An account's standing in the fuseDrivers game beside its rating. */
export interface FuseDriversTotals {
  totals: FuseDriversTotalsRecord;
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
  "laps",
  "kills",
  "deaths",
  "lapsLed",
  "nitrosUsed",
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
    // How far round the track the driver got, in hundredths of a checkpoint.
    matchScoreUnits: MAX_PROGRESS_UNITS * MAX_ROUNDS,
    matchPlacement: MAX_MATCH_PARTICIPANTS,
    earlyExits: 1,
    laps: MAX_LAPS,
    kills: MAX_EVENTS,
    deaths: MAX_EVENTS,
    lapsLed: MAX_LAPS,
    nitrosUsed: MAX_EVENTS,
  };
  if (!COUNTERS.every((key) => count(raw[key], most[key]))) return;
  if ((raw.matchPlacement as number) < 1) return;
  if ((raw.lapsLed as number) > (raw.laps as number)) return;
  // Counters are bounded one by one, so nothing else stops a forged report claiming more races won than
  // raced and crediting itself the difference.
  if ((raw.roundWins as number) > (raw.roundsPlayed as number)) return;
  const player: Record<string, unknown> = {};
  for (const key of KEYS) player[key] = raw[key];
  return player as unknown as FuseDriversStats;
}

export const emptyFuseDriversTotals = (): FuseDriversTotalsRecord =>
  Object.fromEntries(
    TOTAL_KEYS.map((key) => [key, 0]),
  ) as FuseDriversTotalsRecord;

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
    laps: player.laps,
    kills: player.kills,
    deaths: player.deaths,
    lapsLed: player.lapsLed,
    nitrosUsed: player.nitrosUsed,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyFuseDriversTotals() };
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
