import { ACTION, BOT, JOIN, PRESENCE, type StreamEntries } from "fuse-netcode";
import {
  CONTROLS,
  DEFAULT_SETTINGS,
  createRoom,
  foldTick,
  packControls,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
} from "../../src/game/index.js";
import { NEUTRAL_INPUT, type TruckInput } from "../../src/game/sim/input.js";

export const SETTINGS: FuseDriversSettings = DEFAULT_SETTINGS;

/** Entry bodies (everything after seq and tick) each member logs at the next tick. */
export type Bodies = Record<string, readonly unknown[][]>;

let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
export function fold(
  room: FuseDriversRoom,
  bodies: Bodies = {},
): FuseDriversEvent[] {
  const tick = room.tick + 1;
  const streams = new Map<string, StreamEntries<FuseDriversEntry>>();
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

/** A room where `a` (slot 0) and `b` (slot 1) are seated, connected, and racing match `m1`. */
export function started(
  settings: FuseDriversSettings = SETTINGS,
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
  fold(room, {
    a: [
      [PRESENCE, "a", true, 1],
      [PRESENCE, "b", true, 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}

export const addBot = (id: string, slot: number): unknown[] => [
  BOT,
  "add",
  id,
  `CPU ${String(slot + 1)}`,
  slot,
];

/** The body of a controls entry, for a driver holding `input`. */
export const drive = (input: Partial<TruckInput>): unknown[] => [
  CONTROLS,
  packControls({ ...NEUTRAL_INPUT, ...input }),
];
