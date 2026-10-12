import type { ManagedRoom, SeatRecord, Stage } from "fuse-netcode";
import type { Economy } from "./economy.js";
import type { Goals, PlayerState } from "./state.js";

export interface FuseLaneSettings {
  /** Real seconds per week: 45, 60 or 90. */
  weekSeconds: number;
  /** One shared screen with phones as controllers. */
  display: boolean;
  /**
   * Hot-seat weeks: players take turns playing the same week, one after another, each with their own clock (bots play
   * theirs at once). Off, everyone plays the week at the same time (an online room).
   */
  turns: boolean;
  /** How well the bots play: 0 easy, 1 normal, 2 hard. */
  level: number;
}

/** The week runs; the Monday briefing; a hot-seat week waiting for the next player to take the device. */
export const WEEK = 0,
  BRIEFING = 1,
  HANDOFF = 2;
export type Phase = typeof WEEK | typeof BRIEFING | typeof HANDOFF;

export interface RosterEntry {
  name: string;
  slot: number;
}

/** The whole room: seats and settings (managed by the netcode's entries), and the game. Plain data throughout. */
export interface FuseLaneRoom extends ManagedRoom<FuseLaneSettings> {
  /** The log tick folded through; the game clock is the same tick. */
  tick: number;
  matchId: string;
  stage: Stage;
  /** The week length this match plays with, in ticks: `settings.weekSeconds` as it was at the start. */
  weekTicks: number;
  /** The generator's state (mulberry32), seeded from the match id. */
  rng: number;
  week: number;
  phase: Phase;
  /** The tick the phase began and the tick it ends at the latest. */
  phaseStart: number;
  phaseEnd: number;
  /** The match's mode and bot level, from the settings at its start (settings may change mid-match; these do not). */
  turns: boolean;
  level: number;
  /** A hot-seat week: who plays it, in order (the first seat rotates weekly), and whose turn it is (-1 before any). */
  order: string[];
  turn: number;
  economy: Economy;
  /** Every player of this match, departed seats included, by id. */
  players: Record<string, PlayerState>;
  /** The goals each member picked in the lobby. */
  goals: Record<string, Goals>;
  /** Everyone who sat in this match, as they were last seated. */
  roster: Record<string, RosterEntry>;
  /** This Monday's headlines. */
  headlines: string[];
  /**
   * When the match is over: every player, best first; and the winners, the top of that ranking (several only on an
   * exact tie).
   */
  ranking: string[];
  winners: string[];
}

/** Seated players (no watchers) in slot order. */
export function seated(room: FuseLaneRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);
}
/** A seat that plays its weeks: a bot, or a human who is here. */
export const active = (seat: SeatRecord | undefined): boolean =>
  seat !== undefined && !seat.watcher && (seat.bot || seat.connected);
/** Player ids in a stable order: roster slot, then id. */
export function playerOrder(room: FuseLaneRoom): string[] {
  return Object.keys(room.players).sort(
    (a, b) =>
      (room.roster[a]?.slot ?? 99) - (room.roster[b]?.slot ?? 99) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
}
export const nameOf = (room: FuseLaneRoom, id: string): string =>
  room.seats.get(id)?.name ?? room.roster[id]?.name ?? "Someone";
