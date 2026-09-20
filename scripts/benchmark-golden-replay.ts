/**
 * Times the golden mechanic recording (games/fuse-riders/tests/fixtures/mechanics-recording.json) through `applyTick`, with and without
 * the per-tick canonical hash. This is the C7 evidence for issue #253: what a re-simulated tick costs a rollback.
 *
 *   pnpm exec tsx scripts/benchmark-golden-replay.ts [runs=5]
 *
 * The engine path is resolved at run time so the same file can be copied onto a revision from before the move to
 * `src/engine/` (or to `games/fuse-riders/`) and produce the comparable "before" number.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const game = existsSync(new URL("games/fuse-riders/src", root))
  ? "games/fuse-riders/"
  : "";
const engine = existsSync(new URL(`${game}src/engine/apply-tick.ts`, root))
  ? `${game}src/engine`
  : `${game}src/shared`;
const { applyTick, createRoomState, hashRoomState, RULES } = await import(
  new URL(`${engine}/apply-tick.ts`, root).href
);
const { BotController } = await import(
  new URL(`${engine}/bot-controller.ts`, root).href
);
const { defaultRoomSettings } = await import(
  new URL(`${engine}/room-settings.ts`, root).href
);
const { streamReader } = await import(
  new URL(`${game}tests/fixtures/replay-log.ts`, root).href
);

const recording = JSON.parse(
  readFileSync(
    new URL(`${game}tests/fixtures/mechanics-recording.json`, root),
    "utf8",
  ),
);
const runs = Number(process.argv[2] ?? 5);

function replay(hash: boolean): { ms: number; last: string } {
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    streams = streamReader(recording.entries);
  let last = "";
  const started = process.hrtime.bigint();
  for (let tick = 1; tick <= recording.ticks; tick++) {
    applyTick(state, recording.creator, streams(tick), bots);
    if (hash) last = hashRoomState(state);
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, last: last || hashRoomState(state) };
}

function summarise(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return `min ${sorted[0]!.toFixed(0)} ms, median ${median.toFixed(0)} ms (${(
    (median * 1000) /
    recording.ticks
  ).toFixed(1)} µs/tick) over ${samples.length} runs`;
}

const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
})
  .toString()
  .trim();
console.log(
  `revision ${revision}, rules ${RULES}, engine at ${engine}, node ${process.version}`,
);
console.log(
  `workload: ${recording.ticks} ticks, match ${recording.matchId}, ${game}tests/fixtures/mechanics-recording.json`,
);
replay(false); // warm the JIT before anything is measured
const plain: number[] = [],
  hashed: number[] = [];
let final = "";
for (let run = 0; run < runs; run++) {
  const a = replay(false);
  plain.push(a.ms);
  final = a.last;
  hashed.push(replay(true).ms);
}
console.log(`applyTick only:        ${summarise(plain)}`);
console.log(`applyTick + tick hash: ${summarise(hashed)}`);
console.log(`final state hash ${final}`);
