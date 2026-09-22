/**
 * How long a log tick costs with a full grid, and what a worst-case rollback costs.
 *
 * The racer runs 30 Hz of simulation inside a 20 Hz log, so a tick folds two steps or one across five
 * trucks, their weapons and pickups. Rollback re-simulates up to forty ticks, which is the number that
 * has to stay inside a frame.
 *
 *   npx tsx scripts/fuse-drivers-tick-cost.ts
 */
import { ACTION, BOT, JOIN, PRESENCE, type StreamEntries } from "fuse-netcode";
import {
  CONTROLS,
  DEFAULT_SETTINGS,
  createRoom,
  foldTick,
  packControls,
  type FuseDriversEntry,
  type FuseDriversRoom,
} from "../games/fuse-drivers/src/game/index.js";
import { NEUTRAL_INPUT } from "../games/fuse-drivers/src/game/sim/input.js";

let seq = 0;
const fold = (
  room: FuseDriversRoom,
  bodies: Record<string, unknown[][]> = {},
) => {
  const tick = room.tick + 1;
  const streams = new Map<string, StreamEntries<FuseDriversEntry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((b) => [++seq, tick, ...b] as FuseDriversEntry),
    });
  foldTick(room, "a", streams);
};

const room = createRoom("m0", DEFAULT_SETTINGS);
fold(room, {
  a: [
    [JOIN, "a", "Ada", 0, "fox", 1],
    ...[1, 2, 3, 4].map((n) => [BOT, "add", `bot:${n}`, `CPU ${n + 1}`, n]),
  ],
});
fold(room, { a: [[PRESENCE, "a", true, 1]] });
fold(room, { a: [[ACTION, "start", "m1"]] });

const TICKS = 2000;
const turn = packControls({ ...NEUTRAL_INPUT, right: true });
const start = performance.now();
for (let i = 0; i < TICKS; i++)
  fold(room, i % 40 === 0 ? { a: [[CONTROLS, i % 80 === 0 ? turn : 0]] } : {});
const ms = performance.now() - start;
const perTick = ms / TICKS;
console.log(`five trucks, ${TICKS} log ticks in ${ms.toFixed(0)} ms`);
console.log(`  ${perTick.toFixed(3)} ms per log tick (the budget is 50 ms)`);
console.log(
  `  a 40-tick rollback re-simulates in ${(perTick * 40).toFixed(1)} ms`,
);
console.log(`  race reached tick ${room.race?.tick ?? 0}, stage ${room.stage}`);
