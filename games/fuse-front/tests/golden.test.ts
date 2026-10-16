import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES,
  createWorld,
  decodeWorld,
  encodeWorld,
  hashWorld,
  levelOf,
  seedOf,
  stepTick,
  type Command,
  type GameMap,
  type World,
} from "../src/engine/index.js";
import { dustBasin } from "./fixtures/maps.js";

/**
 * The engine's safety net: six seats on Dust Basin for 1500 log ticks with scripted factory orders, stances, hero
 * moves, steering and casts (the ultimates refused below level 6), the units walking their stances' flow fields, taking flags and fighting, the heroes levelling,
 * dying and respawning. The world's hash is compared every 250 ticks. A refactor must keep these; a change to the
 * rules must bump `RULES` in `src/engine/tuning.ts` and re-record them in the same commit: `GOLDEN_RECORD=1` prints
 * the new ones.
 */
const GOLDEN = {
  rules: "fuse-front-5",
  seed: "fuse-front golden",
  ticks: 1500,
  hashes: [
    "8ccfa88c",
    "01016175",
    "a86ce8e9",
    "9f26d20f",
    "a7bc62d0",
    "caadd767",
  ],
};

const SCRIPT = new Map<number, Command[]>([
  [5, [{ seat: 1, type: "stance", stance: "hold" }]],
  [20, [{ seat: 2, type: "move", x: 36, y: 15 }]],
  [40, [{ seat: 2, type: "stance", stance: "follow" }]],
  [60, [{ seat: 3, type: "steer", dx: -8, dy: 1 }]],
  [300, [{ seat: 3, type: "steer", dx: 0, dy: 0 }]],
  [320, [{ seat: 0, type: "move", x: 47, y: 27 }]],
  [450, [{ seat: 0, type: "cast", slot: 1, x: 0, y: 0 }]],
  [500, [{ seat: 2, type: "move", x: 59, y: 15 }]],
  [620, [{ seat: 0, type: "cast", slot: 0, x: 0, y: 0 }]],
  [1200, [{ seat: 1, type: "cast", slot: 3, x: 0, y: 0 }]],
  [1400, [{ seat: 4, type: "cast", slot: 3, x: 0, y: 0 }]],
  [700, [{ seat: 1, type: "stance", stance: "push" }]],
  [900, [{ seat: 5, type: "move", x: 36, y: 41 }]],
]);

/** Each seat orders torches from every robot factory it holds on tick 400 and grunts again on tick 1000. */
function orders(map: GameMap, world: World, tick: number): Command[] {
  if (tick !== 400 && tick !== 1000) return [];
  const kind = tick === 400 ? "torch" : "grunt";
  return world.buildings.flatMap((building) => {
    const site = map.sites[building.id]!;
    const owner = world.sectors[site.sector]!;
    return site.kind === "robotFactory" && owner >= 0
      ? [{ seat: owner, type: "order" as const, factory: building.id, kind }]
      : [];
  });
}

/** Ticks `from + 1` to `to` of the scripted run, with the hash of every 250th tick. */
function play(
  map: GameMap,
  start: World,
  from: number,
  to: number,
): { world: World; hashes: string[] } {
  let world = start;
  const hashes: string[] = [];
  for (let tick = from + 1; tick <= to; tick++) {
    world = stepTick(map, world, [
      ...(SCRIPT.get(tick) ?? []),
      ...orders(map, world, tick),
    ]);
    if (tick % 250 === 0) hashes.push(hashWorld(world));
  }
  return { world, hashes };
}

const fresh = (map: GameMap): World =>
  createWorld(map, [0, 1, 2, 3, 4, 5], seedOf(GOLDEN.seed));

test("the golden run hashes as recorded", () => {
  assert.equal(RULES, GOLDEN.rules, "RULES changed: re-record the golden");
  const map = dustBasin();
  const { world, hashes } = play(map, fresh(map), 0, GOLDEN.ticks);
  if (process.env.GOLDEN_RECORD) console.log(JSON.stringify(hashes));
  assert.ok(world.units.length > 30, "the run builds an army");
  assert.ok(
    world.sectors.filter((owner) => owner >= 0).length > 6,
    "the run takes sectors",
  );
  assert.ok(
    world.heroes.every((hero) => levelOf(hero.xp) > 1),
    "every hero levels",
  );
  assert.deepEqual(hashes, GOLDEN.hashes);
});

test("a run resumed from a decoded mid-match checkpoint reaches the same hashes", () => {
  const map = dustBasin();
  const early = play(map, fresh(map), 0, 750);
  assert.deepEqual(early.hashes, GOLDEN.hashes.slice(0, 3));
  // What a late joiner or a rollback restores: the wire form, not the live object.
  const restored = decodeWorld(
    JSON.parse(JSON.stringify(encodeWorld(early.world))),
    map,
  );
  assert.ok(restored, "the checkpoint decodes");
  assert.equal(hashWorld(restored), hashWorld(early.world));
  const late = play(map, restored, 750, GOLDEN.ticks);
  assert.deepEqual(late.hashes, GOLDEN.hashes.slice(3));
});
