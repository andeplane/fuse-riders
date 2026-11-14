import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";
import {
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
  RULES,
} from "../src/engine/index.js";
import * as online from "../src/online/game.js";

/**
 * The online safety net: two scripted Queens and four hard bots play a set to two wins through the fold, its hash
 * taken every 30 seconds and at the end. A change to how a logged room plays bumps `RULES` in `src/engine/index.ts`
 * and re-records these in the same commit (`GOLDEN_RECORD=1 pnpm exec tsx --test
 * games/killer-fuse/tests/online-golden.test.ts` prints them to paste); a failure without one is a regression to fix.
 */
const GOLDEN = {
  rules: "killer-fuse-6",
  end: "over at 4263: map 3 0:military@3431, map 1 1:military@2373, map 2 1:military@5006 \u2192 1, presses 1460",
  hashes: [
    "bc3f5b96caa181d2",
    "447bfe4d5c041417",
    "e53f6c5d697a9b70",
    "c46eee4f85e9e955",
    "305943e43dbeea58",
    "45d31377e3eaa73b",
    "f126f6b8b1143459",
    "2f4ac8f01259ddcf",
  ],
};

const HOLDS = [
  INPUT_LEFT,
  INPUT_LEFT | INPUT_HELD,
  INPUT_RIGHT,
  INPUT_DOWN,
  INPUT_RIGHT | INPUT_HELD,
  0,
  INPUT_LEFT | INPUT_DOWN,
];
const LIMIT = 30_000;

function record() {
  const settings: online.Settings = {
    ...online.DEFAULT_SETTINGS,
    botLevel: "hard",
    map: 0,
    wins: 2,
    display: false,
  };
  const room = online.createRoom("golden", settings);
  let seq = 0,
    ordinal = 0,
    presses = 0;
  const fold = (bodies: Record<string, unknown[][]>) => {
    const tick = room.tick + 1,
      streams = new Map<string, StreamEntries<online.Entry>>();
    for (const [id, list] of Object.entries(bodies)) {
      const entries = list.map((body) => [++seq, tick, ...body]);
      streams.set(id, { generation: 1, entries: entries as online.Entry[] });
    }
    online.foldTick(room, "a", streams);
  };
  fold({
    a: [
      [JOIN, "a", "Ada", 0, "bee", 1],
      [JOIN, "b", "Bo", 1, "bee", 1],
    ],
  });
  fold({ a: [[ACTION, "start", "g1"]] });
  /** A Queen that changes what it holds every `period` ticks and presses every `tap`, on the step the tick's number gives. */
  const queen = (period: number, phase: number, turn: number, tap: number) => {
    const t = room.tick + phase,
      scope = [room.matchId, room.round];
    const out: unknown[][] = [];
    if (t % period === 0)
      out.push([online.PLAY, ...scope, HOLDS[((t / period) * turn) % 7]]);
    if (t % tap === 0) {
      out.push([online.PRESS, ...scope, ++ordinal, t % 3]);
      presses++;
    }
    return room.stage === "running" ? out : [];
  };
  const hashes: string[] = [];
  let spent = 0n,
    stepped = 0;
  while (room.stage !== "over" && room.tick < LIMIT) {
    const playing = room.stage === "running" && room.tick + 1 >= room.startAt,
      begun = process.hrtime.bigint();
    fold({ a: queen(45, 0, 1, 7), b: queen(70, 11, 3, 5) });
    if (playing)
      [spent, stepped] = [spent + process.hrtime.bigint() - begun, stepped + 1];
    if (room.tick % 600 === 0) hashes.push(online.hash(room));
  }
  hashes.push(online.hash(room));
  const games = room.results.map(
    (r) => `map ${r.mapId} ${r.team}:${r.kind}@${r.steps}`,
  );
  return {
    end: `${room.stage} at ${room.tick}: ${games.join(", ")} → ${room.winner}, presses ${presses}`,
    hashes,
    ms: Number(spent) / 1e6 / stepped,
  };
}

test("a recorded online set replays to its recorded hashes under the current rules", () => {
  const { end, hashes, ms } = record();
  console.log(`six units: ${ms.toFixed(3)} ms per log tick of 3 steps`);
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, end, hashes }, null, 2));
  assert.equal(RULES, GOLDEN.rules, "RULES changed: re-record the golden");
  assert.equal(end, GOLDEN.end);
  assert.deepEqual(
    hashes,
    GOLDEN.hashes,
    "how a logged room plays changed: bump RULES and re-record, or fix the regression",
  );
});
