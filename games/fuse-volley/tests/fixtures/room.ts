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
import { courtOf, type Side } from "../../src/engine/index.js";
import * as T from "../../src/engine/tuning.js";

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
/** `a` against `b` in match `m1`, its first serve hovering. */
export function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = seated(settings);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
/** Ends rallies against `loser` until the match is over. */
export function finish(room: Room, loser: Side): void {
  for (let i = 0; i < 40 && room.stage === "running"; i++) {
    const world = room.world!;
    if (world.phase === "serve" || world.phase === "rally") {
      // Drop the ball onto the loser's sand.
      Object.assign(world.ball, {
        x: courtOf(world).serveX[loser],
        y: T.BALL_FLOOR + 10,
        vx: 0,
        vy: -50,
        live: true,
      });
      world.phase = "rally";
      world.phaseSteps = 0;
      world.lastTouch = -1;
    }
    run(room, 60);
  }
  assert.equal(room.stage, "over");
}
