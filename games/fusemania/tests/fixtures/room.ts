import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";
import { TICK_MS } from "../../src/engine/index.js";
import {
  createFusemaniaGame,
  type Entry,
  type FusemaniaGame,
  type Room,
  type Settings,
} from "../../src/online/game.js";
import { testLibrary } from "./songs.js";

export const library = testLibrary();
export const game: FusemaniaGame = createFusemaniaGame(library);
/** "grid" on its Easy chart, as a score match. */
export const SETTINGS: Settings = {
  display: false,
  song: "grid",
  mode: 0,
  chart: 0,
  songs: 1,
  random: false,
};

export type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
const ticker = game.createTicker();
/** Folds one log tick of `bodies`, every stream at generation 1. */
export function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  ticker(room, "a", streams);
}
export const run = (room: Room, ticks: number) => {
  for (let i = 0; i < ticks; i++) fold(room);
};
/** Folds empty ticks until the match's song time is `ms` (a multiple of the tick). */
export function runTo(room: Room, ms: number): void {
  while (room.world && room.stage === "running" && room.world.ms < ms)
    fold(room);
}
export { TICK_MS };

/** `a` and `b` seated in a lobby. */
export function seated(settings: Settings = SETTINGS): Room {
  const room = game.createRoom("m0", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  return room;
}
/** `a` and `b` playing match `m1`. */
export function started(settings: Settings = SETTINGS): Room {
  const room = seated(settings);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
