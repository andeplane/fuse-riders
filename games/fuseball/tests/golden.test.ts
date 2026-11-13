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
 * slides, bubbles hard and soft, pops, slow motion, goals, zaps, resets and, on two maps, the end of the match) and
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
  rules: "fuseball-2",
  hashes: {
    gridlock: [
      "38a368e7",
      "03ef2720",
      "e1a5e00c",
      "8578ffc1",
      "f88e4b27",
      "a03b776e",
      "c9e421af",
      "048ca779",
      "7104f661",
      "17c3a67c",
      "d98552c2",
      "e90df44d",
      "c5fa10d0",
      "e6ffb886",
      "ec1ce50a",
      "c3840acb",
      "504e0a8e",
      "2608ea53",
      "3885a2f6",
      "07e869cc",
      "07e869cc",
    ],
    downlink: ["9f2df590", "ee060e8d", "254f3482", "df13b5f8", "8440aef4"],
    halo: ["4a9a5703", "4399243e", "48c229b1"],
  },
  bots: {
    gridlock: ["cb97ce1a", "638e96c6", "a0e174ed", "cbed5da3"],
    downlink: ["32dcb285", "2faee30e", "b7b31967", "57347881"],
    halo: ["10efbebe", "33f8ad8b", "e95f8dee", "6e4445a1"],
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
