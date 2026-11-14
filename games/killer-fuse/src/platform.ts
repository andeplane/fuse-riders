import {
  MAX_MATCH_PARTICIPANTS,
  type GameRegistration,
  type PlayerResult,
} from "fuse-platform";
import {
  CAPACITY,
  MAX_COUNT,
  MAX_GAMES,
  isBotId,
  validName,
} from "./online/basics.js";

/**
 * Killer Fuse's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * set adds to an account. The room service registers it in `service/history.ts`; attestation, settlement, Elo and
 * storage are the platform's. It imports only `online/basics.ts`, so the service never loads the netcode or the engine.
 *
 * A result names people only: the bots that fill the free slots are not players of it. A "round" of the platform is
 * one game of the set.
 */

/** One player's result as the platform stores it; `online/result.ts` builds it. */
export interface KillerFuseStats extends PlayerResult {
  /** 1 for a player of the winning team. A lone person who lost to bots is still placed first, so placement cannot say it. */
  won: number;
  /** Units this player's unit killed, and times it died. */
  kills: number;
  deaths: number;
  /** Berries this player banked, carried in or kicked in. */
  berries: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "gameWins",
  "kills",
  "deaths",
  "berries",
] as const;
export type KillerFuseTotalsRecord = Record<
  (typeof TOTAL_KEYS)[number],
  number
>;
/** An account's standing in Killer Fuse beside its rating. */
export interface KillerFuseTotals {
  totals: KillerFuseTotalsRecord;
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
  "won",
  "kills",
  "deaths",
  "berries",
] as const satisfies readonly (keyof KillerFuseStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
const COUNTERS = KEYS.slice(2) as readonly Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The storage and wire boundary for one player: every field checked, unknown ones refused, rebuilt in one key order. */
export function parseKillerFuseStats(
  raw: unknown,
  rounds: number,
): KillerFuseStats | undefined {
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
  const games = Math.min(rounds, MAX_GAMES);
  const most: Record<Counter, number> = {
    slot: CAPACITY - 1,
    roundsPlayed: games,
    roundWins: games,
    // Games won, for a set and for one game's receipt alike.
    matchScoreUnits: games,
    matchPlacement: MAX_MATCH_PARTICIPANTS,
    earlyExits: 1,
    won: 1,
    kills: MAX_COUNT,
    deaths: MAX_COUNT,
    berries: MAX_COUNT,
  };
  if (!COUNTERS.every((key) => count(raw[key], most[key]))) return;
  if ((raw.matchPlacement as number) < 1) return;
  if ((raw.roundWins as number) > (raw.roundsPlayed as number)) return;
  if (raw.won === 1 && raw.matchPlacement !== 1) return;
  const player: Record<string, unknown> = {};
  for (const key of KEYS) player[key] = raw[key];
  return player as unknown as KillerFuseStats;
}

export const emptyKillerFuseTotals = (): KillerFuseTotalsRecord =>
  Object.fromEntries(
    TOTAL_KEYS.map((key) => [key, 0]),
  ) as KillerFuseTotalsRecord;

export const killerFuseRegistration: GameRegistration<
  KillerFuseStats,
  KillerFuseTotals,
  KillerFuseTotalsRecord
> = {
  id: "killer-fuse",
  isBot: isBotId,
  parseStats: parseKillerFuseStats,
  emptyTotals: () => ({ totals: emptyKillerFuseTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.won,
    gameWins: player.roundWins,
    kills: player.kills,
    deaths: player.deaths,
    berries: player.berries,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyKillerFuseTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyKillerFuseTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
