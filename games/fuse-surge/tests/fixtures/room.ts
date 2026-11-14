import assert from "node:assert/strict";
import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  createRoom,
  foldTick,
  type BotInput,
  type Entry,
  type Room,
  type Settings,
} from "../../src/online/game.js";

export type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
export function fold(room: Room, bodies: Bodies = {}, bot?: BotInput): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams, bot);
}
export const run = (room: Room, ticks: number, bot?: BotInput) => {
  for (let i = 0; i < ticks; i++) fold(room, {}, bot);
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
/** `a` against `b` in match `m1`, its first countdown running. */
export function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = seated(settings);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
/** Knocks everyone but the rider in `winner` off the deck, round after round, until the match is over. */
export function finish(room: Room, winner = 0): void {
  for (let i = 0; i < 4000 && room.stage === "running"; i++) {
    const world = room.world!;
    if (world.phase === "play")
      for (const [slot, rider] of world.riders.entries())
        if (slot !== winner && !rider.out)
          Object.assign(rider, {
            hits: world.rules.hits,
            out: true,
            duck: false,
            reel: 0,
            grace: 0,
          });
    run(room, 1);
  }
  assert.equal(room.stage, "over");
}
