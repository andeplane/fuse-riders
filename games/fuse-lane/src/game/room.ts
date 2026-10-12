import type { ManagedRoom, SeatRecord, Stage } from "fuse-netcode";
import type { Economy } from "./economy.js";
import type { Goals, PlayerState } from "./state.js";

export interface FuseLaneSettings {
  /** Real seconds per week: 45, 60 or 90. */
  weekSeconds: number;
  /** One shared screen with phones as controllers. */
  display: boolean;
}

export const WEEK = 0,
  BRIEFING = 1;

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
  phase: typeof WEEK | typeof BRIEFING;
  /** The tick the phase began and the tick it ends at the latest. */
  phaseStart: number;
  phaseEnd: number;
  economy: Economy;
  /** Every player of this match, departed seats included, by id. */
  players: Record<string, PlayerState>;
  /** The goals each member picked in the lobby. */
  goals: Record<string, Goals>;
  /** Everyone who sat in this match, as they were last seated. */
  roster: Record<string, RosterEntry>;
  /** This Monday's headlines. */
  headlines: string[];
  /** When the match is over: every player, best first; and the winners (who met all goals in the same week). */
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
