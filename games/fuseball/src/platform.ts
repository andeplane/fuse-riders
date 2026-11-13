import type { GameRegistration, PlayerResult } from "fuse-platform";
import { CAPACITY, TARGET, isBotId, validName } from "./basics.js";

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

/** The engine's cosmetic counters wrap at 65536 (`engine/tuning.ts` `COUNTER`): a match reports at most this many. */
export const MAX_COUNTER = 0xffff;
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
  bubbles: MAX_COUNTER,
  pops: MAX_COUNTER,
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
 * The whole field: a duel is two riders on the two sides, one of whom won, and the board adds up — a side's points
 * are its rider's goals plus the other rider's own goals.
 */
export function validFuseballField(players: readonly FuseballStats[]): boolean {
  const [a, b] = players;
  return (
    players.length === CAPACITY &&
    a !== undefined &&
    b !== undefined &&
    a.slot !== b.slot &&
    a.roundWins + b.roundWins === 1 &&
    a.matchScoreUnits === a.goals + b.ownGoals &&
    b.matchScoreUnits === b.goals + a.ownGoals
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
