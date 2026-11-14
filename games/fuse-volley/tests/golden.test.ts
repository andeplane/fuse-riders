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
} = {
  rules: "fuse-volley-1",
  hashes: {
    rally: [
      "0c948a24",
      "74af6b1b",
      "1957ed2c",
      "05d5a418",
      "63b1f06c",
      "9f081374",
      "0019c17d",
    ],
    classic: [
      "955f20ea",
      "c6d6fb88",
      "73e10aba",
      "a8010d52",
      "de4af619",
      "c4bda975",
      "4a4e1535",
      "6ce1624f",
      "5b710bdf",
      "5d13fda9",
      "33c8f186",
      "51e26f1e",
      "4675684e",
      "c7400b94",
      "d5029fb5",
      "43710fd3",
      "a6f3046f",
      "e3e10cd8",
      "54ff1095",
      "a1d9edce",
      "0f9fa808",
      "526d34bc",
      "53ca7efd",
      "7bfdcb93",
      "b52a24fb",
      "f9323e72",
      "7cd8603d",
      "c0321e01",
      "549b1974",
      "4b0592c6",
      "8c243156",
      "d4ae2435",
      "4502120f",
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
function pilot(world: World, side: 0 | 1, roll: number): number {
  const me = world.blobs[side],
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

function record(bots = false): Record<Scoring, string[]> {
  const recorded = { rally: [] as string[], classic: [] as string[] };
  for (const scoring of ["rally", "classic"] as const) {
    const world = createWorld(["bot:1", "bot:2"], scoring, 20261114),
      next = scripted(20261114),
      hashes = recorded[scoring];
    const hash = () => hashes.push(fnv(JSON.stringify(encodeWorld(world))));
    for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
      const inputs: [number, number] = bots
        ? [botInput(world, 0, 2), botInput(world, 1, 0)]
        : [pilot(world, 0, next()), pilot(world, 1, next())];
      for (let i = 0; i < T.STEPS_PER_TICK; i++) stepWorld(world, inputs);
      if (tick % EVERY === 0) hash();
    }
    hash();
  }
  return recorded;
}

test("recorded matches replay to their recorded hashes under the current rules", () => {
  const hashes = record(),
    bots = record(true);
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, hashes, bots }));
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
});
