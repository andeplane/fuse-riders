import type { GameRegistration, PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  MOST_NOTES,
  MOST_RATING,
  isBotId,
  validName,
} from "./basics.js";

/**
 * Fusemania's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never
 * loads the engine, the charts or the netcode.
 */

/** One player's result as the platform stores it; the room's result module (`online/result.ts`) reports the same shape. */
export interface FusemaniaStats extends PlayerResult {
  /** The score out of 1,000,000 for the chart played. */
  rating: number;
  /** The longest combo. */
  combo: number;
  marvelous: number;
  perfect: number;
  great: number;
  /** Notes hit at all. */
  steps: number;
  misses: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "steps",
  "marvelous",
  "misses",
] as const;
export type FusemaniaTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
/** An account's standing in Fusemania beside its rating. */
export interface FusemaniaTotals {
  totals: FusemaniaTotalsRecord;
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
  "rating",
  "combo",
  "marvelous",
  "perfect",
  "great",
  "steps",
  "misses",
] as const satisfies readonly (keyof FusemaniaStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: MOST_RATING,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  rating: MOST_RATING,
  combo: MOST_NOTES,
  marvelous: MOST_NOTES,
  perfect: MOST_NOTES,
  great: MOST_NOTES,
  steps: MOST_NOTES,
  misses: MOST_NOTES,
};
const COUNTERS = Object.keys(MOST) as Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The storage and wire boundary for one player: every field checked, unknown ones refused, rebuilt in one key order.
 * A Fusemania match is one round (one song) to the platform, so a result of any other length is not one of ours.
 */
export function parseFusemaniaStats(
  raw: unknown,
  rounds: number,
): FusemaniaStats | undefined {
  if (!plain(raw) || rounds !== 1) return;
  if (
    Object.keys(raw).length !== KEYS.length ||
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
  if (!COUNTERS.every((key) => count(raw[key], MOST[key]))) return;
  const number = (key: Counter) => raw[key] as number;
  if (
    number("roundsPlayed") !== 1 ||
    number("matchPlacement") < 1 ||
    number("roundWins") !== (number("matchPlacement") === 1 ? 1 : 0) ||
    number("rating") !== number("matchScoreUnits") ||
    number("marvelous") + number("perfect") + number("great") >
      number("steps") ||
    number("combo") > number("steps") ||
    number("steps") + number("misses") > MOST_NOTES
  )
    return;
  return {
    playerId,
    name,
    slot: number("slot"),
    roundsPlayed: number("roundsPlayed"),
    roundWins: number("roundWins"),
    matchScoreUnits: number("matchScoreUnits"),
    matchPlacement: number("matchPlacement"),
    earlyExits: number("earlyExits"),
    rating: number("rating"),
    combo: number("combo"),
    marvelous: number("marvelous"),
    perfect: number("perfect"),
    great: number("great"),
    steps: number("steps"),
    misses: number("misses"),
  };
}

/** The whole field: one to five players in distinct seats and distinct places 1 to n, a higher rating never placed lower. */
export function validFusemaniaField(
  players: readonly FusemaniaStats[],
): boolean {
  if (players.length < 1 || players.length > CAPACITY) return false;
  const slots = new Set(players.map((player) => player.slot)),
    places = new Set(players.map((player) => player.matchPlacement));
  if (
    slots.size !== players.length ||
    places.size !== players.length ||
    [...slots].some((slot) => slot >= players.length) ||
    [...places].some((place) => place > players.length)
  )
    return false;
  const ranked = [...players].sort(
    (a, b) => a.matchPlacement - b.matchPlacement,
  );
  return ranked.every(
    (player, index) =>
      index === 0 || player.rating <= ranked[index - 1]!.rating,
  );
}

export const emptyFusemaniaTotals = (): FusemaniaTotalsRecord => ({
  matches: 0,
  wins: 0,
  steps: 0,
  marvelous: 0,
  misses: 0,
});

export const fusemaniaRegistration: GameRegistration<
  FusemaniaStats,
  FusemaniaTotals,
  FusemaniaTotalsRecord
> = {
  id: "fusemania",
  isBot: isBotId,
  parseStats: parseFusemaniaStats,
  validField: validFusemaniaField,
  emptyTotals: () => ({ totals: emptyFusemaniaTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    steps: player.steps,
    marvelous: player.marvelous,
    misses: player.misses,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyFusemaniaTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFusemaniaTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
