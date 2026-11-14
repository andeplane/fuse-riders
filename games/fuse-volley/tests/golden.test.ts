import test from "node:test";
import assert from "node:assert/strict";
import {
  JUMP,
  LEFT,
  RIGHT,
  RULES,
  botInput,
  createWorld,
  encodeWorld,
  stepWorld,
  type Scoring,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { scripted } from "./fixtures/world.js";

/**
 * The engine's safety net: two scripted pilots play recorded matches under both scorings (serves, hits, grazes, the
 * net, faults, settles and the end of a match), and the world's hash is compared every fifteen seconds. A refactor
 * must keep these; a change to the rules must bump `RULES` in `src/engine/index.ts` and re-record them in the same
 * commit (`GOLDEN_RECORD=1` prints the new ones).
 *
 * The pilots are this test's own, so `hashes` moves only when the physics or the rules do. The engine's bot is part
 * of the rules too (every device folds a bot seat with it), so `bots` holds a second recording, of the bot playing
 * itself at two levels: that one moves whenever the bot's answers do.
 */
const GOLDEN: {
  rules: string;
  hashes: Record<Scoring, string[]>;
  bots: Record<Scoring, string[]>;
  /** Two a side on the wide court: the pilots, then the bots (hard and normal against easy and normal). */
  doubles: { pilots: string[]; bots: string[] };
} = {
  doubles: {
    pilots: [
      "692e8d88",
      "36c7d18f",
      "24cbbbb5",
      "3507ac8b",
      "5fc929e8",
      "7d99b543",
      "c21f5f4b",
    ],
    bots: [
      "0d7d7905",
      "f8f5d3a1",
      "44baf032",
      "9f87995d",
      "dac2636a",
      "be738071",
      "b77f7e22",
      "94b450a8",
      "5367a090",
    ],
  },
  rules: "fuse-volley-3",
  hashes: {
    rally: [
      "7a4b3e99",
      "b04ac866",
      "5df4361d",
      "4aa60485",
      "307da4fc",
      "31f185e6",
      "60463547",
    ],
    classic: [
      "b28a1fbb",
      "78d0fb99",
      "272a0067",
      "d85694bf",
      "96256f5f",
      "03c30624",
      "d72332aa",
      "3b94abc8",
      "c254d081",
      "347b9b18",
      "b3bc0fa7",
      "9247816e",
      "01388562",
      "ae5e5741",
      "b6aa0c35",
      "58f56af1",
      "4f857bca",
      "4deddb92",
      "b57b36ca",
      "da62b86a",
      "c6ba315a",
      "b3a45abf",
    ],
  },
  bots: {
    rally: [
      "54dad919",
      "e6cb0c64",
      "ea8e1583",
      "0e1db171",
      "66cfe9d4",
      "6231458c",
      "df0cb39c",
    ],
    classic: [
      "5574b9d4",
      "bc0b0f30",
      "1086a283",
      "5d19efb1",
      "bccd978e",
      "14462561",
      "05473cf5",
      "c03c1bd1",
      "4e4b8ec9",
      "d26a8928",
      "73369307",
      "5b14e1ca",
    ],
  },
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Mostly under the ball on its own side, sometimes wandering; jumps by the roll. */
function pilot(world: World, slot: number, roll: number): number {
  const me = world.blobs[slot]!,
    side = me.side,
    bx = world.ball.x / T.BU;
  const behind = side === 0 ? -14 : 14;
  let bits = bx + behind > me.x ? RIGHT : LEFT;
  if ((roll >> 6) % 8 < 2) bits = (roll >> 9) % 2 ? LEFT : RIGHT;
  if (roll % 4 === 0 && Math.abs(bx - me.x) < 80) bits |= JUMP;
  if (roll % 16 === 5) bits |= JUMP;
  return bits;
}

const TICKS = 12_000,
  EVERY = 300;

function record(bots = false, blobs = 2): Record<Scoring, string[]> {
  const recorded = { rally: [] as string[], classic: [] as string[] };
  for (const scoring of ["rally", "classic"] as const) {
    const world = createWorld(
        ["bot:1", "bot:2", "bot:3", "bot:4"].slice(0, blobs),
        scoring,
        20261114,
      ),
      next = scripted(20261114),
      hashes = recorded[scoring];
    const hash = () => hashes.push(fnv(JSON.stringify(encodeWorld(world))));
    for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
      const levels = [2, 0, 1, 1] as const;
      const inputs = world.blobs.map((_, slot) =>
        bots
          ? botInput(world, slot, levels[slot]!)
          : pilot(world, slot, next()),
      );
      for (let i = 0; i < T.STEPS_PER_TICK; i++) stepWorld(world, inputs);
      if (tick % EVERY === 0) hash();
    }
    hash();
  }
  return recorded;
}

test("recorded matches replay to their recorded hashes under the current rules", () => {
  const hashes = record(),
    bots = record(true),
    doubles = {
      pilots: record(false, 4).rally,
      bots: record(true, 4).rally,
    };
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, hashes, bots, doubles }));
  assert.equal(
    RULES,
    GOLDEN.rules,
    "RULES changed: re-record the golden in the same commit",
  );
  assert.deepEqual(
    hashes,
    GOLDEN.hashes,
    "the engine's behaviour changed: bump RULES and re-record, or fix the regression",
  );
  assert.deepEqual(
    bots,
    GOLDEN.bots,
    "the bot's play changed: bump RULES and re-record, or fix the regression",
  );
  assert.deepEqual(
    doubles,
    GOLDEN.doubles,
    "doubles changed: bump RULES and re-record, or fix the regression",
  );
});
