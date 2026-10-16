import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES,
  TILE,
  UNITS,
  centreOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  hashWorld,
  seedOf,
  stepTick,
  teamOf,
  type Command,
  type GameMap,
  type World,
} from "../src/engine/index.js";
import { dustBasin } from "./fixtures/maps.js";

/**
 * The engine's safety net: six seats on Dust Basin for 1500 log ticks with scripted factory orders and stances, and
 * every 150 ticks each seat's oldest robot set down on the nearest flag its team does not hold (standing in for the
 * movement a later rule adds). The world's hash is compared every 250 ticks. A refactor must keep these; a change
 * to the rules must bump `RULES` in `src/engine/tuning.ts` and re-record them in the same commit: `GOLDEN_RECORD=1`
 * prints the new ones.
 */
const GOLDEN = {
  rules: "fuse-front-1",
  seed: "fuse-front golden",
  ticks: 1500,
  hashes: [
    "59d8c1d1",
    "72be0b0f",
    "353356de",
    "ae3b837a",
    "caad27a9",
    "b733f3b2",
  ],
};

const SCRIPT = new Map<number, Command[]>([
  [5, [{ seat: 1, type: "stance", stance: "hold" }]],
  [40, [{ seat: 2, type: "stance", stance: "follow" }]],
  [700, [{ seat: 1, type: "stance", stance: "push" }]],
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

function advance(map: GameMap, world: World): World {
  const units = world.units.map((unit) => ({ ...unit }));
  for (const player of world.players) {
    const robot = units.find(
      (u) => u.owner === player.seat && UNITS[u.kind].robot,
    );
    if (robot === undefined) continue;
    const tx = Math.floor(robot.x / TILE),
      ty = Math.floor(robot.y / TILE);
    let best = -1,
      bestDistance = Infinity;
    for (const [index, flag] of map.flags.entries()) {
      const owner = world.sectors[index]!;
      if (owner >= 0 && teamOf(owner) === player.team) continue;
      const distance = Math.max(Math.abs(flag.x - tx), Math.abs(flag.y - ty));
      if (distance < bestDistance) [best, bestDistance] = [index, distance];
    }
    if (best < 0) continue;
    robot.x = centreOf(map.flags[best]!.x);
    robot.y = centreOf(map.flags[best]!.y);
  }
  return { ...world, units };
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
    if (tick % 150 === 0) world = advance(map, world);
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
