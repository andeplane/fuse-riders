import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import { DOWN, LEFT, RIGHT, RULES, UP } from "../src/engine/index.js";
import * as online from "../src/online/game.js";

/**
 * The online safety net: two scripted pilots and four bots play a match to two wins through the fold, its hash taken
 * every minute and at the end (the run also times six gunships' log tick, against a re-run pass's 6 ms). A change to how
 * a logged room plays bumps `RULES` in `src/engine/index.ts` and re-records these in the same commit (`GOLDEN_RECORD=1
 * pnpm exec tsx --test games/fuse-bombers/tests/online-golden.test.ts` prints them to paste); a failure without one is
 * a regression to fix (docs/design/engine-safety-net.md, "When the golden fails").
 */
const GOLDEN = {
  rules: "fuse-bombers-1",
  end: "over at 5646: b:last-standing b:last-standing → b, shots 86,86",
  hashes: [
    "44d88bd44f811771",
    "671eb7cb8e4cb55b",
    "5de9ecd38e74ec84",
    "f23e41563e44cd11",
    "83c0734db113a248",
  ],
};

const COMPASS = [UP, UP | RIGHT, RIGHT, DOWN | RIGHT, DOWN, DOWN | LEFT, LEFT];
const LIMIT = 9_000;

function record() {
  const settings = { wins: 2, difficulty: "hard", display: false } as const;
  const room = online.createRoom("golden", settings);
  let seq = 0,
    ordinal = 0;
  const shots = [0, 0]; // the pilots' volleys, so the script is seen to play
  const fold = (bodies: Record<string, unknown[][]>) => {
    const tick = room.tick + 1,
      streams = new Map<string, StreamEntries<online.Entry>>();
    for (const [id, list] of Object.entries(bodies)) {
      const entries = list.map((body) => [++seq, tick, ...body]);
      streams.set(id, { generation: 1, entries: entries as online.Entry[] });
    }
    for (const e of online.foldTick(room, "a", streams))
      if (e.type === "fired" && e.castleId < 2) shots[e.castleId]!++;
  };
  const bots = [2, 3, 4, 5].map((n) => [BOT, "add", `bot:${n}`, "Zeppo", n]);
  fold({
    a: [
      [JOIN, "a", "Ada", 0, "gunship", 1],
      [JOIN, "b", "Bo", 1, "gunship", 1],
      ...bots,
    ],
  });
  fold({ a: [[ACTION, "start", "g1"]] });
  /** A pilot that turns every `period` ticks and presses every 31, on the step the tick's number gives. */
  const pilot = (period: number, phase: number, turn: number) => {
    const t = room.tick + phase,
      scope = [room.matchId, room.round];
    const out: unknown[][] = [];
    if (t % period === 0)
      out.push([online.PLAY, ...scope, COMPASS[((t / period) * turn) % 7]]);
    if (t % 31 === 0) out.push([online.PRESS, ...scope, ++ordinal, t % 3]);
    return room.stage === "running" ? out : [];
  };
  const hashes: string[] = [];
  let spent = 0n,
    stepped = 0;
  while (room.stage !== "over" && room.tick < LIMIT) {
    const flying = room.stage === "running" && room.tick + 1 >= room.startAt,
      begun = process.hrtime.bigint();
    fold({ a: pilot(45, 0, 1), b: pilot(70, 11, 3) });
    if (flying)
      [spent, stepped] = [spent + process.hrtime.bigint() - begun, stepped + 1];
    if (room.tick % 1200 === 0) hashes.push(online.hash(room));
  }
  const ms = Number(spent) / 1e6 / stepped;
  hashes.push(online.hash(room));
  const rounds = room.results.map((r) => `${r.winner || "draw"}:${r.reason}`);
  return {
    end: `${room.stage} at ${room.tick}: ${rounds.join(" ")} → ${room.winner}, shots ${shots}`,
    hashes,
    ms,
  };
}

test("a recorded online match replays to its recorded hashes under the current rules", () => {
  const { end, hashes, ms } = record();
  console.log(`six gunships: ${ms.toFixed(3)} ms per log tick of 3 steps`);
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
