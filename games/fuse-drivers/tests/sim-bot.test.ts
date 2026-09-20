import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_STATS } from "../src/game/sim/config.js";
import {
  createRace,
  step,
  type RaceEvent,
  type RaceState,
} from "../src/game/sim/race.js";
import { parseTrack } from "../src/game/sim/track.js";
import {
  botInput,
  createBotMemory,
  type BotMemory,
  type Difficulty,
} from "../src/game/sim/bot.js";
import { defined } from "./fixtures/defined.js";

const track = parseTrack(
  JSON.parse(readFileSync("games/fuse-drivers/tracks/refinery.tmj", "utf8")),
  "refinery",
);
/** Per-track tick budget for one hard-bot lap (ADR 007); tighten as tracks and bots improve. */
const LAP_BUDGET_TICKS = 30 * 20;

/**
 * The upstream repo drove this through `createRaceRunner`, which this port leaves behind: the
 * monorepo owns the fixed-step loop. Advancing exactly one tick per call is what that runner did
 * when handed a single `TICK_MS`, so the bot sees the same sequence of states.
 */
function createBotDriver(seed: number, difficulty: Difficulty) {
  let state = createRace(track, seed, [BASE_STATS]);
  let memory: BotMemory = createBotMemory(seed, 0);
  return {
    advance(): { state: RaceState; events: RaceEvent[] } {
      const [input, next] = botInput(state, 0, memory, track, difficulty);
      memory = next;
      const r = step(state, [input], track);
      state = r.state;
      return r;
    },
  };
}

function firstLapTicks(difficulty: Difficulty, seed = 3): number {
  // Easy bots are sloppy on purpose (ADR 007) and may slide along a tight hairpin; only hard bots must not ride walls.
  const r = createBotDriver(seed, difficulty);
  let start = 0,
    maxWall = 0,
    wall = 0;
  for (let i = 0; i < 30 * 60; i++) {
    const { state, events } = r.advance();
    if (events.some((e) => e.type === "start")) start = state.tick;
    wall = defined(state.trucks[0])!.wallTicks;
    maxWall = Math.max(maxWall, wall);
    const lap = events.find((e) => e.type === "lap");
    if (lap) {
      assert.ok(
        difficulty !== "hard" || maxWall < 30,
        `bot rode a wall for ${maxWall} ticks`,
      );
      return lap.tick - start;
    }
  }
  assert.fail(`${difficulty} bot never completed a lap`);
}

test("a hard bot laps the refinery within budget without wall riding", () => {
  assert.ok(firstLapTicks("hard") <= LAP_BUDGET_TICKS);
});

test("an easy bot is slower than a hard bot on the same seed", () => {
  assert.ok(firstLapTicks("easy") > firstLapTicks("hard"));
});
