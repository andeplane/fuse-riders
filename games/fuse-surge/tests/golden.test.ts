import test from "node:test";
import assert from "node:assert/strict";
import {
  DUCK,
  JUMP,
  RULES,
  botInput,
  createWorld,
  encodeWorld,
  stepWorld,
  type BotLevel,
  type Pace,
  type Rules,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { scripted } from "./fixtures/world.js";

/**
 * The engine's safety net: scripted pilots play recorded matches at every pace and with different settings (jumps,
 * hops, dives, ducks, hits, knock-outs, footholds won back, flips, draws and the end of a match), and the world's
 * hash is compared every ten seconds. A refactor must keep these; a change to the rules must bump `RULES` in
 * `src/engine/index.ts` and re-record them in the same commit (`GOLDEN_RECORD=1` prints the new ones).
 *
 * The pilots are this test's own, so `pilots` moves only when the physics or the rules do. The engine's bot is part
 * of the rules too (every device folds a bot seat with it), so `bots` holds a second recording, of the bots playing
 * each other at every level: that one moves whenever the bot's answers do.
 */
const GOLDEN: { rules: string; pilots: string[][]; bots: string[][] } = {
  rules: "fuse-surge-1",
  pilots: [
    ["bbffe29c", "8c98d469", "d5189d09", "6f88a4f1", "95e2f7fa", "a6b7e73c"],
    ["9e790136", "933dbc79", "cec9856e", "6f83715d"],
    ["9c3e217b", "07b18293", "faf06e23"],
    ["5c10b5c9", "f4a5347f", "914dbcf8"],
  ],
  bots: [
    [
      "4ec4d923",
      "00a7aed9",
      "0dc372bd",
      "bfd21853",
      "cabe77f6",
      "53004c69",
      "7ba38f06",
    ],
    [
      "ee38e0ee",
      "f1f1eee3",
      "e5c12ca6",
      "d6e0c8de",
      "b3739e0e",
      "600f6d8e",
      "dba5af71",
      "e0683e3c",
    ],
    [
      "7487f301",
      "9c525647",
      "a260fe56",
      "8f688f3f",
      "cf97ecf8",
      "f50a0b7d",
      "3a7874c4",
      "14d89be9",
      "88ce6354",
      "6da0d9f1",
    ],
    ["3ac318c9", "a1991f49", "d2331ce3"],
  ],
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Jumps and ducks by the roll, mostly when something is near, so it clears some surges and is struck by others. */
function pilot(world: World, slot: number, roll: number): number {
  const me = world.riders[slot]!;
  const near = world.surges.find(
    (surge) => !(surge.done & (1 << slot)) && surge.x - me.x < 90 * T.U,
  );
  if (!near) return roll % 23 === 0 ? JUMP : roll % 29 === 0 ? DUCK : 0;
  const sound = near.kind === 0 ? JUMP : DUCK;
  if (roll % 9 === 0) return sound === JUMP ? DUCK : JUMP;
  if (roll % 7 === 0) return 0;
  return roll % 11 === 0 ? JUMP | DUCK : sound;
}

const MATCHES: readonly { riders: number; rules: Rules }[] = [
  {
    riders: 2,
    rules: { hits: 3, seconds: 60, pace: 1, target: 3, recover: true },
  },
  {
    riders: 5,
    rules: { hits: 4, seconds: 30, pace: 2, target: 2, recover: true },
  },
  {
    riders: 3,
    rules: { hits: 2, seconds: 45, pace: 0, target: 2, recover: false },
  },
  {
    riders: 4,
    rules: { hits: 9, seconds: 20, pace: 1 as Pace, target: 1, recover: true },
  },
];
const TICKS = 12_000,
  EVERY = 200;

function record(bots: boolean): string[][] {
  return MATCHES.map(({ riders, rules }) => {
    const world = createWorld(
        ["bot:1", "bot:2", "bot:3", "bot:4", "bot:5"].slice(0, riders),
        rules,
        20261114,
      ),
      next = scripted(20261114),
      hashes: string[] = [];
    const hash = () => hashes.push(fnv(JSON.stringify(encodeWorld(world))));
    for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
      const inputs = world.riders.map((_, slot) =>
        bots
          ? botInput(world, slot, (slot % 3) as BotLevel)
          : pilot(world, slot, next()),
      );
      for (let i = 0; i < T.STEPS_PER_TICK; i++) stepWorld(world, inputs);
      if (tick % EVERY === 0) hash();
    }
    hash();
    return hashes;
  });
}

test("recorded matches replay to their recorded hashes under the current rules", () => {
  const pilots = record(false),
    bots = record(true);
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, pilots, bots }));
  assert.equal(
    RULES,
    GOLDEN.rules,
    "RULES changed: re-record the golden in the same commit",
  );
  assert.deepEqual(
    pilots,
    GOLDEN.pilots,
    "the engine's behaviour changed: bump RULES and re-record, or fix the regression",
  );
  assert.deepEqual(
    bots,
    GOLDEN.bots,
    "the bot's play changed: bump RULES and re-record, or fix the regression",
  );
});
