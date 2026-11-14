import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";
import type { GameEvent, VictoryKind } from "../../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  OUTRO_TICKS,
  createRoom,
  foldTick,
  type Entry,
  type Room,
  type Settings,
} from "../../src/online/game.js";

/** Entry bodies (without `[seq, tick]`) per member stream. */
export type Bodies = Record<string, readonly (readonly unknown[])[]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1; returns the tick's events. `a` is the creator. */
export function fold(room: Room, bodies: Bodies = {}): GameEvent[] {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  return foldTick(room, "a", streams);
}
export const run = (room: Room, ticks: number): void => {
  for (let i = 0; i < ticks; i++) fold(room);
};
/** Runs the countdown out: the next fold runs the game's first steps. */
export const toPlay = (room: Room): void =>
  run(room, room.startAt - room.tick - 1);
/** Member ids as the platform takes them: 24 hex characters. `a` (the creator), `b`, … by their first letter. */
export const ID = {
  a: "a".repeat(24),
  b: "b".repeat(24),
  c: "c".repeat(24),
  d: "d".repeat(24),
  e: "e".repeat(24),
  f: "f".repeat(24),
};
export const join = (id: string, name: string, slot: number): unknown[] => [
  JOIN,
  id,
  name,
  slot,
  "bee",
  1,
];
/** `a` (Ada, slot 0) and `b` (Bo, slot 1) seated in the lobby. */
export function lobby(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("m0", settings);
  fold(room, { a: [join("a", "Ada", 0), join("b", "Bo", 1)] });
  return room;
}
/** `lobby` with the set `m1` started: its first game counts down. */
export function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = lobby(settings);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
/**
 * Decides the running game for `team` as if the tick just folded had: the engine keeps a decided round as it is, and
 * the fold shows the victory for `OUTRO_TICKS` from the deciding tick.
 */
export function decide(
  room: Room,
  team: number,
  kind: VictoryKind = "military",
): void {
  room.world!.winner = { team, kind };
  room.endAt = room.tick + OUTRO_TICKS;
}
/** Plays the running game to its record: a step, a decision for `team`, and the victory screen. */
export function finish(
  room: Room,
  team: number,
  kind: VictoryKind = "military",
): void {
  toPlay(room);
  fold(room);
  decide(room, team, kind);
  run(room, OUTRO_TICKS);
}
/** A copy of the room to fold another way. */
export const copy = (room: Room): Room => structuredClone(room);
