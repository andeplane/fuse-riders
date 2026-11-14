import type { GameRegistration, PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  MAX_TARGET,
  MIN_RIDERS,
  MOST_DODGES,
  MOST_TAKEN,
  isBotId,
  validName,
} from "./basics.js";

/**
 * Fuse Surge's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never loads
 * the engine or the netcode.
 */

/** One rider's result as the platform stores it; the room's result module (`online/result.ts`) reports the same shape. */
export interface FuseSurgeStats extends PlayerResult {
  /** Rounds won. */
  points: number;
  /** Surges cleared. */
  dodges: number;
  /** Hits taken. */
  hits: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "points",
  "dodges",
  "hits",
] as const;
export type FuseSurgeTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
/** An account's standing in Fuse Surge beside its rating. */
export interface FuseSurgeTotals {
  totals: FuseSurgeTotalsRecord;
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
  "dodges",
  "hits",
] as const satisfies readonly (keyof FuseSurgeStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: MAX_TARGET,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  points: MAX_TARGET,
  dodges: MOST_DODGES,
  hits: MOST_TAKEN,
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
 * A Fuse Surge match reports as one round, so a result of any other length is not one of ours.
 */
export function parseFuseSurgeStats(
  raw: unknown,
  rounds: number,
): FuseSurgeStats | undefined {
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
  if (number("roundsPlayed") !== 1) return;
  // First place, and only first place, has the round; a winner took at least one round of the match.
  const won = number("roundWins") === 1;
  if (
    won !== (number("matchPlacement") === 1) ||
    number("matchPlacement") < 1 ||
    (won && number("points") < 1) ||
    number("points") !== number("matchScoreUnits")
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
    dodges: number("dodges"),
    hits: number("hits"),
  };
}

/**
 * The whole field: two to five riders in the first lanes, each placed by its round wins (riders level on wins share
 * a place), with whoever is first holding the most.
 */
export function validFuseSurgeField(
  players: readonly FuseSurgeStats[],
): boolean {
  if (players.length < MIN_RIDERS || players.length > CAPACITY) return false;
  const slots = new Set(players.map((player) => player.slot));
  if (
    slots.size !== players.length ||
    [...slots].some((slot) => slot >= players.length)
  )
    return false;
  return players.every(
    (player) =>
      player.matchPlacement ===
      1 + players.filter((other) => other.points > player.points).length,
  );
}

export const emptyFuseSurgeTotals = (): FuseSurgeTotalsRecord => ({
  matches: 0,
  wins: 0,
  points: 0,
  dodges: 0,
  hits: 0,
});

export const fuseSurgeRegistration: GameRegistration<
  FuseSurgeStats,
  FuseSurgeTotals,
  FuseSurgeTotalsRecord
> = {
  id: "fuse-surge",
  isBot: isBotId,
  parseStats: parseFuseSurgeStats,
  validField: validFuseSurgeField,
  emptyTotals: () => ({ totals: emptyFuseSurgeTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    points: player.points,
    dodges: player.dodges,
    hits: player.hits,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyFuseSurgeTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFuseSurgeTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
