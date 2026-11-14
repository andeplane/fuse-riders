import test from "node:test";
import assert from "node:assert/strict";
import {
  generateLevel,
  fallbackLevel,
  levelFaults,
  levelCandidate,
} from "../src/engine/generate.js";
import { drift } from "../src/engine/gadgets.js";
import { boxesOf } from "../src/engine/maps.js";
import {
  MAP_IDS,
  MAPS,
  mapOf,
  createWorld,
  botInput,
  paceTick,
  stepWorld,
  encodeWorld,
  decodeWorld,
  mirrored,
  arenaOf,
} from "../src/engine/index.js";

test("the validation flight follows the live engine's unattended ball", () => {
  for (const id of [...MAP_IDS, "random"] as const) {
    const world = createWorld(id, ["a", "b"], 4),
      map = arenaOf(world);
    world.phase = "play";
    world.riders.forEach((rider) => (rider.zapped = true));
    const ball = { ...world.ball },
      barriers = world.barriers.map((state) => ({ ...state }));
    for (let step = 0; step < 1200; step++) {
      drift(ball, map, barriers, world.clock + 1);
      stepWorld(world, new Map());
      if (world.phase !== "play") break;
      assert.deepEqual(
        [ball.x, ball.y, ball.vx, ball.vy],
        [world.ball.x, world.ball.y, world.ball.vx, world.ball.vy],
        `${id} step ${step}`,
      );
      assert.deepEqual(barriers, world.barriers);
    }
  }
});

const SEEDS = [
  ...Array.from({ length: 32 }, (_, n) => n),
  0x80000000,
  0xffffffff,
];

test("34 seeds produce valid, fair mirrored levels, varying wrap, goals, walls, platforms and clouds", () => {
  const layouts = new Set<string>(),
    wraps = new Set<string>(),
    kinds = new Set<string>(),
    counts = new Set<number>();
  for (const seed of SEEDS) {
    const level = mapOf("random", seed);
    assert.deepEqual(levelFaults(level), [], `seed ${seed}`);
    layouts.add(JSON.stringify(level));
    wraps.add(`${level.wrapX},${level.wrapY}`);
    counts.add(level.solids.length);
    const goal = level.goals[0]!;
    kinds.add(
      "r" in goal
        ? "ring"
        : goal.y < 300
          ? "side"
          : goal.x === 12
            ? "corner"
            : "pit",
    );
  }
  assert.ok(layouts.size >= 30);
  assert.equal(wraps.size, 4);
  assert.equal(kinds.size, 4);
  assert.ok(counts.size > 6);
});

test("the shared acceptance validator also accepts every handmade arena and the bounded fallback", () => {
  for (const id of MAP_IDS) assert.deepEqual(levelFaults(MAPS[id]), [], id);
  assert.deepEqual(levelFaults(fallbackLevel()), []);
});

test("the same seed survives fresh generation, cache eviction and deterministic rejection", () => {
  const first = generateLevel(0xffffffff);
  for (let n = 0; n < 10; n++) mapOf("random", n);
  assert.deepEqual(mapOf("random", 0xffffffff), first);
  assert.deepEqual(generateLevel(0xffffffff), first);
  for (const seed of [32]) {
    assert.ok(levelFaults(levelCandidate(seed)).length);
    let next = seed,
      accepted = fallbackLevel();
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = levelCandidate(next);
      if (!levelFaults(candidate).length) {
        accepted = candidate;
        break;
      }
      next = (next + 0x9e3779b9) >>> 0;
    }
    assert.deepEqual(generateLevel(seed), accepted);
  }
});

test("a generated world's id and full uint32 seed round trip and continue identically", () => {
  for (const seed of [0, 1, 4, 5, 0xffffffff]) {
    const world = createWorld("random", ["a", "b"], seed);
    for (let n = 0; n < 450; n++) stepWorld(world, new Map());
    const copy = decodeWorld(encodeWorld(world));
    assert.deepEqual(copy, world);
    assert.ok(copy);
    for (let n = 0; n < 120; n++) {
      stepWorld(world, new Map());
      stepWorld(copy, new Map());
    }
    assert.deepEqual(copy, world);
  }
});

test("the bot scores from both slots on a sample spanning all four generated goal families", () => {
  for (const seed of [0, 1, 4, 5])
    for (const slot of [0, 1] as const) {
      const world = createWorld("random", ["a", "b"], seed);
      for (let tick = 0; tick < 20 * 180 && !world.score[slot]; tick++) {
        const bits = botInput(world, world.riders[slot]);
        for (let left = paceTick(world); left > 0; left--)
          stepWorld(world, new Map([[world.riders[slot].id, bits]]));
      }
      assert.ok(world.score[slot] > 0, `seed ${seed}, slot ${slot}`);
    }
});

test("mirrored controls keep generated gameplay mirror-fair", () => {
  for (const seed of [0, 1, 4, 5]) {
    const world = createWorld("random", ["a", "b"], seed);
    for (let tick = 0; tick < 400; tick++) {
      const bits = tick % 3 === 0 ? 17 : 2;
      for (let left = paceTick(world); left > 0; left--)
        stepWorld(
          world,
          new Map([
            ["a", bits],
            ["b", mirrored(bits)],
          ]),
        );
      assert.equal(world.riders[0].x + world.riders[1].x, 640 * 4096);
      assert.equal(world.riders[0].y, world.riders[1].y);
    }
  }
});
