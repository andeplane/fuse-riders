import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  foldTick,
  createRoom,
  nextRandom,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
} from "../../src/game/index.js";

export const FAST: FuseDriversSettings = { turnTicks: 40, display: false };

/** Entry bodies (everything after seq and tick) each member logs at the next tick. */
export type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
export function fold(
  room: FuseDriversRoom,
  bodies: Bodies = {},
): FuseDriversEvent[] {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<FuseDriversEntry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as FuseDriversEntry),
    });
  return foldTick(room, "a", streams);
}
/** Folds empty ticks until `tick` has been folded, collecting events. */
export function runTo(room: FuseDriversRoom, tick: number): FuseDriversEvent[] {
  const events: FuseDriversEvent[] = [];
  while (room.tick < tick) events.push(...fold(room));
  return events;
}

/** A room where `a` (slot 0) and `b` (slot 1) sit and the match `m1` has started: `a` opens round 1 at tick 2. */
export function started(
  settings: FuseDriversSettings = FAST,
  extra: readonly unknown[][] = [],
): FuseDriversRoom {
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

/** A generator state whose next die is `die`: how a test decides what the room rolls next. */
export function stateFor(die: number): number {
  for (let state = 0; ; state++)
    if (1 + Math.floor((nextRandom(state).value / 0x1_0000_0000) * 6) === die)
      return state;
}
/** Makes the room's next roll `die`. */
export function rig(room: FuseDriversRoom, die: number): void {
  room.rng = stateFor(die);
}
