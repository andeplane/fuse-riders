import type { GameRegistration, PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  LEVEL_COUNT,
  MOST_DEATHS,
  MOST_POINTS,
  isBotId,
  validName,
} from "./basics.js";

/**
 * Elasto Fuse's part of the shared backend (`fuse-platform`): what a rider's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never loads
 * the engine or the netcode.
 */

/** One rider's result as the platform stores it; the room's result module (`online/result.ts`) reports the same shape. */
export interface ElastoFuseStats extends PlayerResult {
  /** Place points over the match's races. */
  points: number;
  /** Races in which the rider reached the flower. */
  finishes: number;
  /** Crashes and restarts. */
  deaths: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "points",
  "finishes",
  "deaths",
] as const;
export type ElastoFuseTotalsRecord = Record<
  (typeof TOTAL_KEYS)[number],
  number
>;
/** An account's standing in Elasto Fuse beside its rating. */
export interface ElastoFuseTotals {
  totals: ElastoFuseTotalsRecord;
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
  "points",
  "finishes",
  "deaths",
] as const satisfies readonly (keyof ElastoFuseStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: MOST_POINTS,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  points: MOST_POINTS,
  finishes: LEVEL_COUNT,
  deaths: MOST_DEATHS,
};
const COUNTERS = Object.keys(MOST) as Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The storage and wire boundary for one rider: every field checked, unknown ones refused, rebuilt in one key order.
 * An Elasto Fuse match is one round to the platform, so a result of any other length is not one of ours.
 */
export function parseElastoFuseStats(
  raw: unknown,
  rounds: number,
): ElastoFuseStats | undefined {
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
    number("points") !== number("matchScoreUnits") ||
    // Points come from finishing: ten at most for each race finished.
    number("points") > number("finishes") * 10
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
    points: number("points"),
    finishes: number("finishes"),
    deaths: number("deaths"),
  };
}

/** The whole field: one to five riders in distinct seats and distinct places 1 to n, more points never placed lower. */
export function validElastoFuseField(
  players: readonly ElastoFuseStats[],
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
      index === 0 || player.points <= ranked[index - 1]!.points,
  );
}

export const emptyElastoFuseTotals = (): ElastoFuseTotalsRecord => ({
  matches: 0,
  wins: 0,
  points: 0,
  finishes: 0,
  deaths: 0,
});

export const elastoFuseRegistration: GameRegistration<
  ElastoFuseStats,
  ElastoFuseTotals,
  ElastoFuseTotalsRecord
> = {
  id: "elasto-fuse",
  isBot: isBotId,
  parseStats: parseElastoFuseStats,
  validField: validElastoFuseField,
  emptyTotals: () => ({ totals: emptyElastoFuseTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    points: player.points,
    finishes: player.finishes,
    deaths: player.deaths,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyElastoFuseTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyElastoFuseTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
