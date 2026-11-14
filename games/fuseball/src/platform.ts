import type { GameRegistration, PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  MOST_BUBBLES,
  TARGET,
  isBotId,
  validName,
} from "./basics.js";

/**
 * Fuseball's part of the shared backend (`fuse-platform`): what a player's reported stats are and what a confirmed
 * match adds to an account. The room service registers it beside the other games' in `service/history.ts`;
 * attestation, settlement, Elo and storage are the platform's. It imports only `basics.ts`, so the service never loads
 * the engine or the netcode.
 */

/** One rider's result as the platform stores it; the room's result module (`online/result.ts`) reports the same shape. */
export interface FuseballStats extends PlayerResult {
  /** Points this rider scored themselves, in their own colour's goal. */
  goals: number;
  /** Points this rider gave away, into the other colour's goal. */
  ownGoals: number;
  /** Bubbles placed. */
  bubbles: number;
  /** Opposing bubbles popped by touch. */
  pops: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "goals",
  "ownGoals",
  "bubbles",
  "pops",
] as const;
export type FuseballTotalsRecord = Record<(typeof TOTAL_KEYS)[number], number>;
/** An account's standing in Fuseball beside its rating. */
export interface FuseballTotals {
  totals: FuseballTotalsRecord;
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
  "goals",
  "ownGoals",
  "bubbles",
  "pops",
] as const satisfies readonly (keyof FuseballStats)[];
type Counter = Exclude<(typeof KEYS)[number], "playerId" | "name">;
/** The most each counter can be in one match: a forged report can inflate the reporter's totals by no more. */
const MOST: Record<Counter, number> = {
  slot: CAPACITY - 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: TARGET,
  matchPlacement: CAPACITY,
  earlyExits: 1,
  goals: TARGET,
  ownGoals: TARGET,
  bubbles: MOST_BUBBLES,
  pops: MOST_BUBBLES,
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
 * A Fuseball match is one round, so a result of any other length is not one of ours.
 */
export function parseFuseballStats(
  raw: unknown,
  rounds: number,
): FuseballStats | undefined {
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
  // One match is one round, and everybody in the result played it.
  if (number("roundsPlayed") !== 1) return;
  // The winner, and only the winner, has the round and the first place; nobody wins without reaching the target.
  const won = number("roundWins") === 1;
  if (
    number("matchPlacement") !== (won ? 1 : 2) ||
    won !== (number("matchScoreUnits") === TARGET) ||
    number("goals") > number("matchScoreUnits")
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
    goals: number("goals"),
    ownGoals: number("ownGoals"),
    bubbles: number("bubbles"),
    pops: number("pops"),
  };
}

/**
 * The whole field: two, four or six riders in the places 0 to n − 1, even places on one side and odd on the other.
 * One side won and every rider of it says so, and the board adds up: a side's points, which each of its riders
 * reports, are its riders' goals plus the other side's own goals.
 */
export function validFuseballField(players: readonly FuseballStats[]): boolean {
  const count = players.length;
  if (count < 2 || count > CAPACITY || count % 2 !== 0) return false;
  if (new Set(players.map((player) => player.slot)).size !== count)
    return false;
  if (players.some((player) => player.slot >= count)) return false;
  const sides = [0, 1].map((side) => {
    const mine = players.filter((player) => player.slot % 2 === side),
      theirs = players.filter((player) => player.slot % 2 !== side);
    return {
      won: mine[0]?.roundWins === 1,
      agreed: mine.every(
        (player) =>
          player.roundWins === mine[0]?.roundWins &&
          player.matchScoreUnits === mine[0]?.matchScoreUnits,
      ),
      score: mine[0]?.matchScoreUnits,
      points:
        mine.reduce((sum, player) => sum + player.goals, 0) +
        theirs.reduce((sum, player) => sum + player.ownGoals, 0),
    };
  });
  return (
    sides.every((side) => side.agreed && side.score === side.points) &&
    sides[0]!.won !== sides[1]!.won
  );
}

export const emptyFuseballTotals = (): FuseballTotalsRecord => ({
  matches: 0,
  wins: 0,
  goals: 0,
  ownGoals: 0,
  bubbles: 0,
  pops: 0,
});

export const fuseballRegistration: GameRegistration<
  FuseballStats,
  FuseballTotals,
  FuseballTotalsRecord
> = {
  id: "fuseball",
  isBot: isBotId,
  parseStats: parseFuseballStats,
  validField: validFuseballField,
  emptyTotals: () => ({ totals: emptyFuseballTotals() }),
  credit: (player) => ({
    matches: 1,
    wins: player.matchPlacement === 1 ? 1 : 0,
    goals: player.goals,
    ownGoals: player.ownGoals,
    bubbles: player.bubbles,
    pops: player.pops,
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit[key];
  },
  parseTotals(document) {
    if (document.totals === undefined) return { totals: emptyFuseballTotals() };
    const stored = document.totals;
    if (
      !plain(stored) ||
      !TOTAL_KEYS.every((key) => count(stored[key], Number.MAX_SAFE_INTEGER))
    )
      return;
    const totals = emptyFuseballTotals();
    for (const key of TOTAL_KEYS) totals[key] = stored[key] as number;
    return { totals };
  },
};
