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
import { mapById } from "../src/online/maps.js";

/**
 * The engine's safety net: six seats (every hero kind) on Crown Jungle, the 3v3 lane map, for 1500 log ticks with
 * scripted hero moves, steering, casts (the ultimates refused below level 6) and a queued route, three waves walking
 * every lane and fighting, the heroes levelling, dying and respawning. The world's hash is compared every 250 ticks. A refactor must keep these; a change to the
 * rules must bump `RULES` in `src/engine/tuning.ts` and re-record them in the same commit: `GOLDEN_RECORD=1` prints
 * the new ones.
 */
const GOLDEN = {
  rules: "fuse-front-19",
  seed: "fuse-front golden",
  ticks: 1500,
  hashes: [
    "ba61352d",
    "d3440e1b",
    "fb2e68e9",
    "2ab5060d",
    "82e73812",
    "81b75dfe",
  ],
};

/** Seat 0's fort, which seat 5's hero is told to attack. */
const crown = (): GameMap => mapById("crown-jungle");
const FORT0 = crown().sites.find(
  (site) => site.kind === "fort" && site.seat === 0,
)!.id;

const SCRIPT = new Map<number, Command[]>([
  [20, [{ seat: 2, type: "move", x: 60, y: 119 }]],
  [60, [{ seat: 3, type: "steer", dx: -8, dy: 1 }]],
  [300, [{ seat: 3, type: "steer", dx: 0, dy: 0 }]],
  [320, [{ seat: 0, type: "move", x: 90, y: 90 }]],
  [450, [{ seat: 0, type: "cast", slot: 1, x: 0, y: 0 }]],
  [500, [{ seat: 2, type: "move", x: 119, y: 60 }]],
  [620, [{ seat: 0, type: "cast", slot: 0, x: 0, y: 0 }]],
  [1200, [{ seat: 1, type: "cast", slot: 3, x: 0, y: 0 }]],
  [1400, [{ seat: 4, type: "cast", slot: 3, x: 0, y: 0 }]],
  [900, [{ seat: 5, type: "move", x: 40, y: 139 }]],
  // The other kits: Vix (seats 1 and 4), Rivet (2) and Tally (3).
  [100, [{ seat: 3, type: "cast", slot: 1, x: 40, y: 139 }]],
  [150, [{ seat: 1, type: "cast", slot: 1, x: 0, y: 0 }]],
  [160, [{ seat: 1, type: "move", x: 90, y: 90 }]],
  [200, [{ seat: 2, type: "cast", slot: 1, x: 0, y: 0 }]],
  [250, [{ seat: 4, type: "cast", slot: 2, x: 0, y: 0 }]],
  [350, [{ seat: 3, type: "cast", slot: 0, x: 90, y: 90 }]],
  [550, [{ seat: 2, type: "cast", slot: 0, x: 0, y: 0 }]],
  [650, [{ seat: 1, type: "cast", slot: 0, x: 90, y: 90 }]],
  [800, [{ seat: 2, type: "cast", slot: 2, x: 0, y: 0 }]],
  [1300, [{ seat: 3, type: "cast", slot: 3, x: 0, y: 0 }]],
  [1350, [{ seat: 2, type: "cast", slot: 3, x: 0, y: 0 }]],
  [1450, [{ seat: 4, type: "cast", slot: 3, x: 0, y: 0 }]],
  // Focus fire, an attack-move and a SNIPE with a chosen target (refused whenever the target is gone or out of reach).
  [330, [{ seat: 4, type: "attackMove", x: 90, y: 90 }]],
  [720, [{ seat: 0, type: "attack", of: 1, id: 1 }]],
  [760, [{ seat: 5, type: "attack", of: 2, id: FORT0 }]],
  [1100, [{ seat: 1, type: "cast", slot: 0, x: 0, y: 0, of: 1, id: 0 }]],
  // A shift-clicked route (`orders.ts`): a move, then an attack on seat 5's hero, a STICKY MINE and a move back.
  [
    1050,
    [
      { seat: 4, type: "move", x: 40, y: 139 },
      { seat: 4, type: "attack", of: 1, id: 5, queued: true },
      { seat: 4, type: "cast", slot: 2, x: 40, y: 139, queued: true },
      { seat: 4, type: "move", x: 90, y: 90, queued: true },
    ],
  ],
]);

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
    world = stepTick(map, world, SCRIPT.get(tick) ?? []);
    if (tick % 250 === 0) hashes.push(hashWorld(world));
  }
  return { world, hashes };
}

const fresh = (map: GameMap): World =>
  createWorld(map, [0, 1, 2, 3, 4, 5], seedOf(GOLDEN.seed), {
    1: "vix",
    2: "rivet",
    3: "tally",
    4: "vix",
  });

test("the golden run hashes as recorded", () => {
  assert.equal(RULES, GOLDEN.rules, "RULES changed: re-record the golden");
  const map = crown();
  const { world, hashes } = play(map, fresh(map), 0, GOLDEN.ticks);
  if (process.env.GOLDEN_RECORD) console.log(JSON.stringify(hashes));
  assert.ok(world.units.length > 30, "the lanes send waves");
  assert.ok(
    world.units.some((unit) => unit.wave === 3),
    "the third wave is out",
  );
  const levels = world.heroes.map((hero) => levelOf(hero.xp));
  // XP goes only to heroes near a death (v3 M4): half of them earn some in 75 s, and one reaches level 2.
  const xps = world.heroes.map((hero) => hero.xp);
  assert.ok(xps.filter((xp) => xp > 0).length >= 3, `${xps}`);
  assert.ok(
    levels.some((level) => level > 1),
    `${levels}`,
  );
  assert.deepEqual(hashes, GOLDEN.hashes);
});

test("a run resumed from a decoded mid-match checkpoint reaches the same hashes", () => {
  const map = crown();
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
