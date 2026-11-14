import type { GameRegistration, PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  CLASSIC_TARGET,
  MOST_HITS,
  RALLY_TARGET,
  SCORE_CAP,
  isBotId,
  validName,
} from "./basics.js";

/**
 * Fuse Volley's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never loads
 * the engine or the netcode.
 */

/** One blob's result as the platform stores it; the room's result module (`online/result.ts`) reports the same shape. */
export interface FuseVolleyStats extends PlayerResult {
  /** Points on this side's board at the end. */
  points: number;
  /** Counted touches of the ball. */
  hits: number;
}
export const TOTAL_KEYS = ["matches", "wins", "points", "hits"] as const;
export type FuseVolleyTotalsRecord = Record<
  (typeof TOTAL_KEYS)[number],
  number
>;
/** An account's standing in Fuse Volley beside its rating. */
export interface FuseVolleyTotals {
  totals: FuseVolleyTotalsRecord;
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
  "hits",
] as const satisfies readonly (keyof FuseVolleyStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: SCORE_CAP,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  points: SCORE_CAP,
  hits: MOST_HITS,
};
const COUNTERS = Object.keys(MOST) as Counter[];

const count = (value: unknown, most: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The storage and wire boundary for one blob: every field checked, unknown ones refused, rebuilt in one key order.
 * A Fuse Volley match is one round, so a result of any other length is not one of ours.
 */
export function parseFuseVolleyStats(
  raw: unknown,
  rounds: number,
): FuseVolleyStats | undefined {
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
  // The winner, and only the winner, has the round and first place; nobody wins short of the lower target.
  const won = number("roundWins") === 1;
  if (
    number("matchPlacement") !== (won ? 1 : 2) ||
    (won && number("matchScoreUnits") < RALLY_TARGET) ||
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
    hits: number("hits"),
  };
}

/**
 * The whole field: two, four or six blobs on the two sides (even slots on the left, odd ones on the right),
 * one side of which won by two (or at the score cap) ahead of the other. Teammates share their side's points and
 * result.
 */
export function validFuseVolleyField(
  players: readonly FuseVolleyStats[],
): boolean {
  if (players.length !== 2 && players.length !== 4 && players.length !== 6)
    return false;
  const slots = new Set(players.map((player) => player.slot));
  if (
    slots.size !== players.length ||
    [...slots].some((slot) => slot >= players.length)
  )
    return false;
  const sides = [0, 1].map((side) =>
    players.filter((player) => player.slot % 2 === side),
  );
  // Each side agrees with itself on the points and the result.
  for (const team of sides) {
    const [first, ...rest] = team;
    if (
      !first ||
      rest.some(
        (mate) =>
          mate.points !== first.points || mate.roundWins !== first.roundWins,
      )
    )
      return false;
  }
  const [a, b] = [sides[0]![0]!, sides[1]![0]!];
  if (a.roundWins + b.roundWins !== 1) return false;
  const [winner, loser] = a.roundWins === 1 ? [a, b] : [b, a];
  // A finished match under either rule: the winner reached the target at least two clear, or went past it by
  // exactly two after a deuce, or stopped at the cap.
  const w = winner.points,
    l = loser.points;
  if (w === SCORE_CAP) return l < w;
  return [RALLY_TARGET, CLASSIC_TARGET].some(
    (target) =>
      (w === target && l <= target - 2) || (w > target && w - l === 2),
  );
}

export const emptyFuseVolleyTotals = (): FuseVolleyTotalsRecord => ({
  matches: 0,
  wins: 0,
  points: 0,
  hits: 0,
});

export const fuseVolleyRegistration: GameRegistration<
  FuseVolleyStats,
  FuseVolleyTotals,
  FuseVolleyTotalsRecord
> = {
  id: "fuse-volley",
  isBot: isBotId,
  parseStats: parseFuseVolleyStats,
  validField: validFuseVolleyField,
  emptyTotals: () => ({ totals: emptyFuseVolleyTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    points: player.points,
    hits: player.hits,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined)
      return { totals: emptyFuseVolleyTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFuseVolleyTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
