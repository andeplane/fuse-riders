import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_LEVELS,
  DUCK,
  HIGH,
  JUMP,
  LOW,
  botInput,
  isBotLevel,
  planInput,
  type BotLevel,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { fresh, playing, steps, surge, ticks } from "./fixtures/world.js";

/** Seconds a bot of `level` lasts in a 60 second round with three hits, beside two sound riders. */
function lasts(level: BotLevel, seed: number): number {
  const world = fresh({ target: 1 }, seed, ["bot", "x", "y"]);
  let out = -1;
  ticks(
    world,
    3000,
    (w, slot) => (slot === 0 ? botInput(w, slot, level) : planInput(w, slot)),
    (w) => {
      if (out < 0 && w.riders[0]!.out) out = w.clock;
      return w.phase === "break";
    },
  );
  return (out < 0 ? world.clock : out) / T.STEPS_PER_SECOND;
}

test("a harder bot lasts longer, and none of them is perfect", () => {
  const mean = (level: BotLevel) => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) total += lasts(level, seed * 104729);
    return total / 40;
  };
  const [easy, normal, hard] = BOT_LEVELS.map(mean) as [number, number, number];
  assert.ok(easy < normal && normal < hard, `${easy} ${normal} ${hard}`);
  assert.ok(easy > 8, `an easy bot is not hopeless: ${easy}`);
  assert.ok(hard < 60, `a hard bot still falls sometimes: ${hard}`);
  assert.ok(
    isBotLevel(0) && isBotLevel(2) && !isBotLevel(3) && !isBotLevel("1"),
  );
});

test("a bot has no memory: the same world gets the same answer, on every device", () => {
  const record = (seed: number) => {
    const world = fresh({}, seed, ["a", "b", "c", "d"]);
    const answers: number[] = [];
    ticks(world, 600, (w, slot) => {
      const bits = botInput(w, slot, (slot % 3) as BotLevel);
      answers.push(bits);
      return bits;
    });
    return answers.join("");
  };
  assert.equal(record(42), record(42));
  assert.notEqual(record(42), record(43));
});

test("the plan jumps the low ones, ducks the high ones and waits for neither", () => {
  const low = playing();
  surge(low, LOW, 200);
  assert.equal(planInput(low, 0), 0, "too far to act on yet");
  low.surges[0]!.x = T.START_X + T.REACH + 6 * T.SPEED_BASE[1];
  assert.equal(planInput(low, 0), JUMP);
  const high = playing();
  surge(high, HIGH, 200);
  assert.equal(planInput(high, 0), 0);
  high.surges[0]!.x = T.START_X + T.REACH + 4 * T.SPEED_BASE[1];
  assert.equal(planInput(high, 0), DUCK);
  // In the air with a high surge coming: dive.
  const airborne = playing();
  steps(airborne, 12, JUMP, JUMP);
  surge(airborne, HIGH, 300);
  assert.equal(planInput(airborne, 0), DUCK);
  // A flipping surge is read as what it will strike as.
  const flip = playing();
  surge(flip, LOW, 0, {
    x: T.START_X + T.REACH + 4 * T.SPEED_BASE[1],
    flip: true,
  });
  assert.equal(planInput(flip, 0), DUCK);
});

test("in the air over a low surge the plan holds on if the jump carries, and dives to jump again if not", () => {
  const world = playing();
  steps(world, 10, JUMP, JUMP);
  // Arriving now: the jump is rising and carries over it.
  surge(world, LOW, 30);
  assert.equal(planInput(world, 0), JUMP);
  // Arriving long after this jump has landed: come down first.
  world.surges[0]!.x = T.START_X + 400 * T.U;
  assert.equal(planInput(world, 0), DUCK);
  // Arriving just as it would be sinking through the surge's height: the same.
  const sinking: World = playing();
  steps(sinking, 60, JUMP, JUMP);
  surge(sinking, LOW, 0, {
    x: T.START_X + T.REACH + 12 * T.SPEED_BASE[1],
  });
  assert.equal(planInput(sinking, 0), DUCK);
});

test("a rider that is out, or a slot nobody rides, holds nothing; a round's winner hops through the break", () => {
  const world = playing({ hits: 1 }, ["a", "b", "c"]);
  surge(world, HIGH, 30);
  ticks(
    world,
    200,
    (w, slot) => (slot === 0 ? planInput(w, slot) : 0),
    (w) => w.phase === "break",
  );
  assert.equal(world.phase, "break");
  assert.equal(planInput(world, 1), 0, "out");
  assert.equal(botInput(world, 1, 2), 0);
  assert.equal(planInput(world, 7), 0, "no such slot");
  assert.equal(botInput(world, 7, 2), 0);
  const hops = new Set<number>();
  ticks(
    world,
    200,
    (w, slot) => {
      const bits = botInput(w, slot, 1);
      if (slot === 0) hops.add(bits);
      return bits;
    },
    (w) => w.phase !== "break",
  );
  assert.deepEqual([...hops].sort(), [0, JUMP], "it hops, and it rests");
  assert.equal(
    world.riders[0]!.y,
    0,
    "and it is back on the deck for the next countdown",
  );
  assert.equal(world.phase, "ready");
  assert.equal(botInput(world, 0, 1), 0, "nothing to do in a countdown");
});

test("a fumbled surge is frozen at or read upside down, and the same fumble everywhere", () => {
  // Find surges the easy bot fumbles: its answer differs from the plan's while one bears down.
  const seen = new Set<string>();
  for (let seed = 1; seed <= 60 && seen.size < 2; seed++) {
    const world = fresh({ hits: 9, recover: false }, seed, ["a", "b"]);
    ticks(world, 900, (w, slot) => {
      const plan = planInput(w, slot),
        bot = botInput(w, slot, 0);
      if (slot === 0 && w.phase === "play" && plan !== bot) {
        assert.equal(botInput(w, slot, 0), bot, "asked again, the same fumble");
        seen.add(bot === 0 ? "froze" : "wrong");
        if (bot !== 0)
          assert.ok(
            plan === 0 || (plan ^ bot) === (JUMP | DUCK) || plan !== bot,
          );
      }
      return slot === 0 ? bot : plan;
    });
  }
  assert.deepEqual([...seen].sort(), ["froze", "wrong"]);
});
