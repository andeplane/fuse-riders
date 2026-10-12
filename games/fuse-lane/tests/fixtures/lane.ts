import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  ACT,
  END_WEEK,
  READY,
  WALK,
  createRoom,
  foldTick,
  type FuseLaneEntry,
  type FuseLaneEvent,
  type FuseLaneRoom,
  type FuseLaneSettings,
} from "../../src/game/index.js";

export const FAST: FuseLaneSettings = { weekSeconds: 45, display: false };

/** Entry bodies (everything after seq and tick) each member logs at the next tick. */
export type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1; `a` is the creator. */
export function fold(room: FuseLaneRoom, bodies: Bodies = {}): FuseLaneEvent[] {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<FuseLaneEntry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as FuseLaneEntry),
    });
  return foldTick(room, "a", streams);
}
/** Folds empty ticks until `tick`, collecting events. */
export function runTo(room: FuseLaneRoom, tick: number): FuseLaneEvent[] {
  const events: FuseLaneEvent[] = [];
  while (room.tick < tick) events.push(...fold(room));
  return events;
}
/** Folds empty ticks while `going` holds (at most `most`). */
export function runWhile(
  room: FuseLaneRoom,
  going: () => boolean,
  most = 100_000,
): void {
  for (let n = 0; n < most && going(); n++) fold(room);
}

/** A room where humans `a` (slot 0) and `b` (slot 1) sit, plus `extra` management bodies, with the match started. */
export function started(
  settings: FuseLaneSettings = FAST,
  extra: readonly unknown[][] = [],
): FuseLaneRoom {
  const room = createRoom("m0", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
      ...extra,
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
export const addBot = (id: string, slot: number): unknown[] => [
  BOT,
  "add",
  id,
  `Bot ${slot + 1}`,
  slot,
];

export const walk = (room: FuseLaneRoom, place: number): unknown[] => [
  WALK,
  room.week,
  place,
];
export const act = (
  room: FuseLaneRoom,
  place: number,
  action: number,
  a = 0,
  b = 0,
): unknown[] => [ACT, room.week, place, action, a, b];
export const endWeekEntry = (room: FuseLaneRoom): unknown[] => [
  END_WEEK,
  room.week,
];
export const ready = (room: FuseLaneRoom): unknown[] => [READY, room.week];

/** Walk `id` into `place` and fold until they are inside. */
export function enter(room: FuseLaneRoom, id: string, place: number): void {
  fold(room, { [id]: [walk(room, place)] });
  runWhile(
    room,
    () => room.players[id]!.inside !== place && !room.players[id]!.done,
    500,
  );
}
/** Both humans call it a week, and everyone taps READY: the next week starts. */
export function nextWeek(room: FuseLaneRoom): void {
  const week = room.week;
  fold(room, { a: [endWeekEntry(room)], b: [endWeekEntry(room)] });
  runWhile(room, () => room.week === week && room.stage === "running", 5000);
  if (room.stage !== "running") return;
  fold(room, { a: [ready(room)], b: [ready(room)] });
  runWhile(room, () => room.phase !== 0 && room.stage === "running", 500);
}
