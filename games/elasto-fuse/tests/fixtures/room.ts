import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  PLAY,
  createRoom,
  foldTick,
  type Entry,
  type Room,
  type Settings,
} from "../../src/online/game.js";
import { LEVELS, STEPS_PER_TICK } from "../../src/engine/index.js";
import { rideBits } from "./rides.js";

export type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
export function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
export const run = (room: Room, ticks: number) => {
  for (let i = 0; i < ticks; i++) fold(room);
};

/** `a` and `b` seated in a lobby. */
export function seated(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("m0", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  return room;
}
/** `a` and `b` racing in match `m1`. */
export function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = seated(settings);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
/**
 * Rides `id` through the room's current race on the recorded ride, logging the held bits whenever they change, until
 * the race is no longer running. The recorded ride changes its bits on tick boundaries (a decision is three ticks),
 * and its turns are presses: down for one step, which the fold gives a bit logged and let go inside one tick.
 */
export function rideHome(room: Room, id: string): void {
  const world = room.world!;
  const bits = rideBits(LEVELS[world.level]!.id);
  // The countdown first, with nothing held.
  while (room.stage === "running" && room.world!.phase === "countdown")
    fold(room);
  let held = 0;
  for (
    let step = 0;
    step < bits.length && room.stage === "running" && room.world === world;
    step += STEPS_PER_TICK
  ) {
    const first = bits[step]!,
      rest = bits[step + 1] ?? first;
    const entries: unknown[][] = [];
    if (first !== held) entries.push([PLAY, room.matchId, first]);
    if (rest !== first) entries.push([PLAY, room.matchId, rest]);
    held = rest;
    fold(room, entries.length ? { [id]: entries } : {});
  }
}
