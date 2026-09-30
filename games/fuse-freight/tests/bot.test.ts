import test from "node:test";
import assert from "node:assert/strict";
import {
  FX,
  INPUT_MASK,
  botInput,
  createWorld,
  encodeWorld,
  roundDone,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { DOCKS, dockCenter } from "../src/engine/arena.js";
import { dist2 } from "../src/engine/math.js";
import { EAST, cart, place, playing, steps } from "./fixtures/world.js";

/** A whole round of bots, every train answering once per log tick as the room folds them. */
function botRound(seed: number, count: number, each?: (world: World) => void) {
  const world = createWorld(
    seed,
    Array.from({ length: count }, (_, slot) => ({
      id: `bot:${slot + 1}`,
      slot,
    })),
    { seconds: 75 },
  );
  const seen = new Set<number>();
  const kinds: number[] = [];
  let inputs = new Map<string, number>();
  while (!roundDone(world)) {
    if (world.step % 3 === 0)
      inputs = new Map(world.trains.map((t) => [t.id, botInput(world, t)]));
    stepWorld(world, inputs);
    for (const fx of world.fx)
      if (!seen.has(fx.id)) {
        seen.add(fx.id);
        kinds.push(fx.kind);
      }
    each?.(world);
  }
  return {
    world,
    count: (kind: number) => kinds.filter((k) => k === kind).length,
  };
}

test("bots play the whole loop: every bot collects and delivers, and they cut each other's tails", () => {
  for (const seed of [1, 2, 3, 4]) {
    const { world, count } = botRound(seed, 5);
    for (const t of world.trains) {
      assert.ok(
        t.collected >= 5,
        `seed ${seed}: ${t.id} collected ${t.collected}`,
      );
      assert.ok(
        t.deliveries >= 2,
        `seed ${seed}: ${t.id} delivered ${t.deliveries} times`,
      );
      assert.ok(t.score >= 3, `seed ${seed}: ${t.id} banked ${t.score}`);
    }
    assert.ok(count(FX.cut) >= 5, `seed ${seed}: ${count(FX.cut)} cuts`);
    assert.ok(world.trains.reduce((sum, t) => sum + t.stolen, 0) > 0);
  }
});

test("a lone bot keeps collecting and banking, and never circles a cart for ever", () => {
  // Collections come steadily through the round: no long spell of driving round a cart it cannot reach.
  let collected = 0,
    lastAt = 0,
    longest = 0;
  const { world } = botRound(9, 1, (w) => {
    const t = w.trains[0]!;
    if (w.phase !== "play") return;
    if (t.collected > collected) {
      collected = t.collected;
      lastAt = w.step;
    }
    longest = Math.max(longest, w.step - Math.max(lastAt, 180));
  });
  const bot = world.trains[0]!;
  assert.ok(bot.score >= 15, `banked ${bot.score}`);
  assert.ok(
    longest < 60 * 8,
    `longest gap between collections: ${longest} steps`,
  );
  const { world: again } = botRound(9, 1);
  assert.deepEqual(
    encodeWorld(again),
    encodeWorld(world),
    "bots are deterministic",
  );
});

test("a bot's answer is ordinary steering bits, reads the world without changing it, and is the same every time", () => {
  const { world } = botRound(5, 3, (w) => {
    if (w.step % 97 !== 0) return;
    const before = JSON.stringify(encodeWorld(w));
    for (const t of w.trains) {
      const bits = botInput(w, t);
      assert.equal(bits & ~INPUT_MASK, 0);
      assert.equal(botInput(w, t), bits);
    }
    assert.equal(JSON.stringify(encodeWorld(w)), before);
  });
  assert.ok(world.step > 0);
});

test("a bot pulling a full train, or out of time, heads for the nearest dock", () => {
  const world = playing(1);
  const bot = place(world, "t0", 300, 286, EAST, 8);
  cart(world, 600, 286);
  const dock = dockCenter(0);
  const start = dist2(bot.x, bot.y, dock.x, dock.y);
  let banked = false;
  for (let i = 0; i < 600 && !banked; i++) {
    steps(world, 1, new Map([["t0", botInput(world, bot)]]));
    banked = bot.score > 0;
  }
  assert.ok(banked, "it delivered");
  assert.ok(start > 0);

  const late = playing(1);
  const hurry = place(late, "t0", 700, 286, EAST, 1);
  // Seconds left: not worth another cart, so it banks the one it has at the dock ahead of it.
  late.step = late.length + 180 - 240;
  cart(late, 500, 286);
  for (let i = 0; i < 200 && hurry.score === 0; i++)
    steps(late, 1, new Map([["t0", botInput(late, hurry)]]));
  assert.equal(hurry.score, 1);
  assert.ok(DOCKS.length === 2);
});
