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
  type Format,
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
  /** Three a side on the big court: the pilots, then the bots. */
  triples: { pilots: string[]; bots: string[] };
  /** Three teams of two, king of the court: the pilots, then the bots, under rally scoring and then classic. */
  kings: { pilots: string[]; bots: string[]; classic: string[] };
} = {
  rules: "fuse-volley-6",
  hashes: {
    rally: [
      "6e5c3bfd",
      "30d9dd04",
      "50bbfd7b",
      "04af7a1b",
      "c9a5d8e4",
      "fc0ba5ca",
      "1dab2b1d",
    ],
    classic: [
      "61c8297f",
      "5607071f",
      "32dbd9dd",
      "d9c9a39d",
      "dfb99897",
      "51105a38",
      "5aec2970",
      "19d15e66",
      "5dda6929",
      "2b3f408c",
      "5a5294bf",
      "1549fe30",
      "0ec84086",
      "d19a25a3",
      "82ba55f3",
      "bcd45459",
      "84802fea",
      "413711ec",
      "5278f3c0",
      "1e526af2",
      "af489b40",
      "11174293",
    ],
  },
  bots: {
    rally: [
      "fb5708bd",
      "cb55cbd2",
      "f4a823ef",
      "e10d2375",
      "98b2890a",
      "cbee60f8",
      "81841838",
    ],
    classic: [
      "477119a4",
      "9846112e",
      "847448ef",
      "a3d3b0b5",
      "14c689cc",
      "37cc421d",
      "5ad77859",
      "a7201047",
      "c80448ff",
      "b168dbe8",
      "0ed74b5b",
      "cded4294",
    ],
  },
  doubles: {
    pilots: [
      "1cd7001e",
      "12f8aab0",
      "46b1e583",
      "cc90ff3f",
      "5558f1b9",
      "5d60ec27",
      "84380aba",
      "14d3eaa9",
      "efb3ae51",
      "53ca0248",
    ],
    bots: [
      "d678c5a1",
      "2d689673",
      "5870e902",
      "70c2f1d0",
      "68503040",
      "45485e4d",
      "cb57179e",
      "5cb69313",
      "1962b0d8",
    ],
  },
  triples: {
    pilots: [
      "7d22297b",
      "d834bcc2",
      "d0037e0e",
      "201b3757",
      "4cd0215e",
      "a3337301",
      "0f388c70",
    ],
    bots: [
      "133ba521",
      "d01fa453",
      "46f8d521",
      "150de3e9",
      "08e49f8d",
      "95a09861",
      "5818ec9a",
      "85933382",
      "0e309a6a",
      "3722f686",
      "1e6caa12",
      "48b9ac22",
      "5e4ce71e",
    ],
  },
  kings: {
    pilots: [
      "87752614",
      "65e674e5",
      "d2b109b5",
      "22013b96",
      "6224eae9",
      "96f662cb",
    ],
    bots: [
      "c7084c19",
      "c88e2de9",
      "3dff8ac2",
      "f1937997",
      "30accf30",
      "5604f70a",
      "68f580f2",
      "fb857483",
      "ea06aa04",
      "e874783b",
      "dce2a38d",
      "bcbc05d3",
      "4ee20929",
    ],
    classic: [
      "7ae37cdc",
      "72e301ee",
      "6be251ad",
      "84899f63",
      "99950bde",
      "0c5bb162",
      "cdff3f82",
      "31d8fe19",
      "9cf935ce",
      "902fd3d2",
      "6bf86da7",
      "5f629132",
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

function record(
  bots = false,
  blobs = 2,
  format?: Format,
): Record<Scoring, string[]> {
  const recorded = { rally: [] as string[], classic: [] as string[] };
  for (const scoring of ["rally", "classic"] as const) {
    const world = createWorld(
        ["bot:1", "bot:2", "bot:3", "bot:4", "bot:5", "bot:6"].slice(0, blobs),
        scoring,
        20261114,
        format,
      ),
      next = scripted(20261114),
      hashes = recorded[scoring];
    const hash = () => hashes.push(fnv(JSON.stringify(encodeWorld(world))));
    for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
      const levels = [2, 0, 1, 1, 0, 2] as const;
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
    },
    triples = {
      pilots: record(false, 6, "3v3").rally,
      bots: record(true, 6, "3v3").rally,
    },
    kingBots = record(true, 6, "2v2v2"),
    kings = {
      pilots: record(false, 6, "2v2v2").rally,
      bots: kingBots.rally,
      classic: kingBots.classic,
    };
  if (process.env.GOLDEN_RECORD)
    console.log(
      JSON.stringify({ rules: RULES, hashes, bots, doubles, triples, kings }),
    );
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
  assert.deepEqual(
    triples,
    GOLDEN.triples,
    "three a side changed: bump RULES and re-record, or fix the regression",
  );
  assert.deepEqual(
    kings,
    GOLDEN.kings,
    "three teams of two changed: bump RULES and re-record, or fix the regression",
  );
});
