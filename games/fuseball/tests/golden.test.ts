import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  paceTick,
  type Rider,
  type World,
  type MapId,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import { scripted } from "./fixtures/world.js";

/**
 * The engine's safety net: on every map two scripted pilots chase the ball through a recorded match (kicks, lifts,
 * slides, bubbles hard and soft, pops, slow motion, goals, zaps, resets and, on some maps, the end of the match) and
 * the world's hash is compared every fifteen seconds. A refactor must keep these; a change to the rules must bump
 * `RULES` in `src/engine/index.ts` and re-record them in the same commit (`GOLDEN_RECORD=1` rewrites the recording,
 * `tests/fixtures/golden.json`).
 *
 * The pilots are this test's own and stay as they are, so `hashes` moves only when the physics or the match rules do.
 * The engine's bot is part of the rules too (every device folds a bot seat with it), so `bots` holds a second
 * recording, of the bot playing itself: that one moves whenever the bot's answers do.
 */
interface Golden {
  rules: string;
  hashes: Record<string, string[]>;
  bots: Record<string, string[]>;
}
const GOLDEN_FILE = fileURLToPath(
  new URL("./fixtures/golden.json", import.meta.url),
);
const GOLDEN = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as Golden;

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
  const arenas: { mapId: MapId; seed: number }[] = [
    ...MAP_IDS.map((mapId) => ({ mapId, seed: 0 })),
    ...[0, 1, 4, 5].map((seed) => ({ mapId: "random" as const, seed })),
  ];
  for (const { mapId, seed } of arenas) {
    const world = createWorld(mapId, ["bot:1", "bot:2"], seed),
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
      for (let left = paceTick(world); left > 0; left--)
        stepWorld(world, inputs);
      if (tick % EVERY === 0) hash();
    }
    hash();
    recorded[mapId === "random" ? `random:${seed}` : mapId] = hashes;
  }
  return recorded;
}

test("a recorded match on every map replays to its recorded hashes under the current rules", () => {
  const hashes = record(),
    bots = record(true);
  if (process.env.GOLDEN_RECORD) {
    writeFileSync(
      GOLDEN_FILE,
      `${JSON.stringify({ rules: RULES, hashes, bots })}\n`,
    );
    return;
  }
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
