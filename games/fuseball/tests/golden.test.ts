import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  DOWN,
  LEFT,
  MAP_IDS,
  RIGHT,
  RULES,
  botInput,
  createWorld,
  encodeWorld,
  stepWorld,
  stepsPerTick,
  type Rider,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import { scripted } from "./fixtures/world.js";

/**
 * The engine's safety net: on every map two scripted pilots chase the ball through a recorded match (kicks, lifts,
 * slides, bubbles hard and soft, pops, slow motion, goals, zaps, resets and, on some maps, the end of the match) and
 * the world's hash is compared every fifteen seconds. A refactor must keep these; a change to the rules must bump
 * `RULES` in `src/engine/index.ts` and re-record them in the same commit (`GOLDEN_RECORD=1` prints the new ones).
 *
 * The pilots are this test's own and stay as they are, so `hashes` moves only when the physics or the match rules do.
 * The engine's bot is part of the rules too (every device folds a bot seat with it), so `bots` holds a second
 * recording, of the bot playing itself: that one moves whenever the bot's answers do.
 */
const GOLDEN: {
  rules: string;
  hashes: Record<string, string[]>;
  bots: Record<string, string[]>;
} = {
  rules: "fuseball-4",
  hashes: {
    gridlock: [
      "38a368e7",
      "6f48da9f",
      "2e8848f1",
      "6f2e668d",
      "de76ea38",
      "9bd0b9ab",
      "19b005fa",
      "a0ee284d",
      "bf6ff8d1",
      "38b53084",
      "ab8261ce",
      "b318012a",
      "dc5a901b",
      "a8de24f1",
      "5f20f4b8",
      "2c2778a4",
      "b415c0d7",
      "8fc45032",
      "0e9dc9c2",
      "fb34b639",
      "fb34b639",
    ],
    downlink: [
      "2c5aee45",
      "d56ba1dc",
      "99a56558",
      "d8afaa92",
      "edacd54b",
      "6ba6b11e",
    ],
    halo: [
      "e25d1580",
      "ec5d2fb8",
      "c5c00d79",
      "3b3a9a66",
      "f5499ab8",
      "07dfb1cd",
      "c84d886a",
      "a925049f",
      "8ef0b2c8",
    ],
    overflow: [
      "bb83f67e",
      "e4b1fdef",
      "d42b49d7",
      "f4b83bea",
      "96a20c1d",
      "5513b596",
      "7624d3ae",
      "86f14453",
    ],
    firewall: ["528abc3a", "9806afbe", "0a3c6a8d", "200963fb", "99926a2e"],
    cornercase: [
      "f43f058c",
      "50c015fc",
      "915aab15",
      "7a84fe83",
      "7d1703c4",
      "0ba9d0d9",
      "09be3026",
      "237bc85a",
      "9b332ea1",
      "143f338e",
      "1c2f3753",
      "2844e550",
      "5515876d",
      "0ec54052",
      "02eac16d",
      "245b9b60",
      "617ed56d",
      "e3386d95",
      "ab4449c4",
      "20e64160",
      "20e64160",
    ],
    coredump: [
      "e0215daa",
      "8b19332e",
      "9fce3e18",
      "d9130055",
      "891a1693",
      "4687e7a1",
      "4543ade3",
      "8a69ba81",
      "32b0a242",
    ],
  },
  bots: {
    gridlock: ["7ec37b16", "21fde060", "bc136f8f", "89de45f5"],
    downlink: ["32dcb285", "2faee30e", "b7b31967", "57347881"],
    halo: ["74e674e2", "8751ea5a", "86b2494d", "d4d2abba"],
    overflow: [
      "3502e6af",
      "5f65ad0f",
      "ab661690",
      "00937a91",
      "4bd5b868",
      "21c7e35e",
      "f330d21d",
    ],
    firewall: ["1d39e70e", "d4c5e6ca", "321db6e9"],
    cornercase: [
      "38073b2a",
      "f51b021c",
      "55217177",
      "fb3855c4",
      "bb55b67a",
      "27d83d73",
      "c1f4f3ac",
      "a0471ca4",
      "fc9664ed",
    ],
    coredump: [
      "63e8e6a0",
      "2641d3df",
      "3fe0a921",
      "e29799fa",
      "9243eb6a",
      "82211a92",
      "23bcc8e2",
      "d2420fd2",
      "d9556fb2",
      "cc92f7f2",
      "b7c7af41",
      "8c459bc4",
      "4627e848",
      "347761bc",
      "78236858",
      "5ac872e9",
      "ca5a76ee",
      "ef98a00a",
      "8dce5a1e",
      "91e08552",
      "91e08552",
    ],
  },
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Mostly behind the ball on the side away from the pilot's own goal, sometimes wandering; presses by the roll. */
function pilot(world: World, rider: Rider, roll: number): number {
  const behind = (rider.slot === 0 ? -12 : 12) * SUB;
  let bits = world.ball.x - rider.x + behind > 0 ? RIGHT : LEFT;
  if ((roll >> 6) % 8 < 3) bits = (roll >> 9) % 2 ? LEFT : RIGHT;
  if (roll % 4 === 0 && world.ball.y < rider.y) bits |= BTN;
  if (roll % 16 === 5) bits |= DOWN | BTN;
  if (roll % 32 === 7) bits |= BTN;
  return bits;
}

const TICKS = 6000,
  EVERY = 300;

function record(bots = false): Record<string, string[]> {
  const recorded: Record<string, string[]> = {};
  for (const mapId of MAP_IDS) {
    const world = createWorld(mapId, ["bot:1", "bot:2"]),
      next = scripted(20261113),
      hashes: string[] = [];
    const hash = () => hashes.push(fnv(JSON.stringify(encodeWorld(world))));
    for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
      const inputs = new Map(
        world.riders.map((rider) => [
          rider.id,
          bots ? botInput(world, rider) : pilot(world, rider, next()),
        ]),
      );
      // A log tick, as the room runs it: the step count is read once, then that many steps with the same inputs.
      for (let left = stepsPerTick(world); left > 0; left--)
        stepWorld(world, inputs);
      if (tick % EVERY === 0) hash();
    }
    hash();
    recorded[mapId] = hashes;
  }
  return recorded;
}

test("a recorded match on every map replays to its recorded hashes under the current rules", () => {
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
