import test from "node:test";
import assert from "node:assert/strict";
import {
  generateLevel,
  fallbackLevel,
  levelFaults,
  levelCandidate,
  gadgetFaults,
} from "../src/engine/generate.js";
import { drift } from "../src/engine/gadgets.js";
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
  type MapDef,
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

/** A seed's level, rolled once for the whole file: rolling is a pure function of the seed, and not a quick one. */
const LEVELS = new Map<number, MapDef>();
function rolled(seed: number): MapDef {
  let level = LEVELS.get(seed);
  if (!level) LEVELS.set(seed, (level = generateLevel(seed)));
  return level;
}

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
    const level = rolled(seed);
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
      // Each try is the layout with its gadgets, then the same layout bare.
      const candidate = [
        levelCandidate(next),
        levelCandidate(next, false),
      ].find((level) => !levelFaults(level).length);
      if (candidate) {
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

/** Which gadget a level was given: one kind a level, or none. */
const gadgetOf = (level: MapDef): string =>
  level.barriers[0]?.kind ??
  (level.bumpers.length
    ? "bumper"
    : level.portals.length
      ? "portal"
      : level.ledges.length
        ? "ledge"
        : level.movers.length
          ? level.movers[0]!.travel.y
            ? "lift"
            : "shuttle"
          : "none");
/** A seed for every kind of gadget the generator places. */
const GADGET_SEEDS = {
  1: "shuttle",
  2: "bumper",
  4: "ledge",
  8: "lift",
  12: "portal",
  17: "field",
  50: "gate",
} as const;

test("a seed's last rolls give its level one kind of gadget, every kind turns up, and some levels stay bare", () => {
  for (const [seed, kind] of Object.entries(GADGET_SEEDS))
    assert.equal(gadgetOf(rolled(Number(seed))), kind, `seed ${seed}`);
  const kinds = new Set(SEEDS.map((seed) => gadgetOf(rolled(seed))));
  assert.ok(kinds.has("none"));
  assert.ok(kinds.size >= 5, [...kinds].join(", "));
  for (const seed of SEEDS) {
    const level = rolled(seed);
    assert.deepEqual(gadgetFaults(level), [], `seed ${seed}`);
    assert.ok(
      [
        level.barriers.length,
        level.bumpers.length,
        level.portals.length,
        level.ledges.length,
        level.movers.length,
      ].filter(Boolean).length <= 1,
      `seed ${seed} has one kind of gadget at most`,
    );
  }
});

test("gadgets are the last thing a seed decides: without them the layout is the same, and bare", () => {
  for (const seed of Object.keys(GADGET_SEEDS).map(Number)) {
    const full = levelCandidate(seed),
      bare = levelCandidate(seed, false);
    assert.equal(gadgetOf(bare), "none");
    assert.deepEqual(
      { wrapX: bare.wrapX, wrapY: bare.wrapY, goals: bare.goals },
      { wrapX: full.wrapX, wrapY: full.wrapY, goals: full.goals },
    );
    assert.deepEqual(bare.clouds, full.clouds);
    // Shelves that became ledges are the only solids that can differ.
    if (gadgetOf(full) !== "ledge") assert.deepEqual(bare.solids, full.solids);
  }
});

test("the bot scores from both slots on a generated level with each kind of gadget", () => {
  for (const seed of Object.keys(GADGET_SEEDS).map(Number))
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

test("mirrored controls keep generated levels with gadgets mirror-fair, and their checkpoints round trip", () => {
  for (const seed of Object.keys(GADGET_SEEDS).map(Number)) {
    const world = createWorld("random", ["a", "b"], seed);
    for (let tick = 0; tick < 400; tick++) {
      const bits = tick % 3 === 0 ? 17 : tick % 7 === 0 ? 1 : 2;
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
    const copy = decodeWorld(encodeWorld(world));
    assert.ok(copy, `seed ${seed}`);
    assert.deepEqual(encodeWorld(copy), encodeWorld(world));
  }
});
