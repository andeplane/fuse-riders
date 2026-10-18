import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_WINNER,
  UNITS,
  UNIT_CAP,
  botCommands,
  buildFlowField,
  centreOf,
  clearFlowCache,
  createWorld,
  decodeWorld,
  encodeWorld,
  flowCacheSize,
  flowFieldBytes,
  hashWorld,
  loadMap,
  stepTick,
  type GameMap,
  type World,
} from "../src/engine/index.js";
import { generate } from "../tools/mapgen/generate.js";
import { TEMPLATES } from "../tools/mapgen/templates.js";
import { referenceField } from "./fixtures/flow-reference.js";

/**
 * Big maps under rollback: the flow field against the pre-E4 one, and the engine's cost, on the largest generated map (Iron Delta, 256×192, six seats). Budgets are generous so a slow CI box cannot flake them;
 * `PERF_LOG=1` prints the measurements.
 */
const big = loadMap(generate(TEMPLATES["iron-delta"]!));
const log = (line: string) => {
  if (process.env.PERF_LOG) console.log(line);
};
const goals = (map: GameMap): number[] => [
  ...map.flags.map((f) => f.y * map.width + f.x),
  ...map.sites
    .filter((s) => s.kind === "fort")
    .map((s) => s.y * map.width + s.x),
];

test("lazy flow fields equal the pre-E4 fields on the largest generated map", () => {
  const sample = goals(big).filter((_, index) => index % 9 === 0);
  for (const goal of sample)
    assert.deepEqual(
      buildFlowField(big, goal).snapshot(),
      referenceField(big, goal),
    );
  let started = performance.now();
  for (const goal of sample) buildFlowField(big, goal).snapshot();
  const lazy = (performance.now() - started) / sample.length;
  started = performance.now();
  for (const goal of sample) referenceField(big, goal);
  const eager = (performance.now() - started) / sample.length;
  log(
    `Iron Delta full field: ${lazy.toFixed(2)} ms (pre-E4 ${eager.toFixed(2)} ms)`,
  );
});

test("the flow caches are sized to the map and stay within a bounded memory", () => {
  const size = flowCacheSize(big);
  assert.ok(
    size.roaming >= 12 && size.roaming < 24,
    `${size.roaming} roaming fields`,
  );
  // The fixed cache only ever holds flags and forts: those plus the roaming fields, in MB.
  const fields = goals(big).length + size.roaming;
  const mb = (fields * flowFieldBytes(big)) / 2 ** 20;
  log(
    `Iron Delta flow caches: ${goals(big).length} fixed + ${size.roaming} roaming fields, ${mb.toFixed(1)} MB`,
  );
  assert.ok(mb < 24, `${mb.toFixed(1)} MB`);
});

const SEATS = [0, 1, 2, 3, 4, 5];
const botTick = (world: World): World =>
  stepTick(
    big,
    world,
    world.players.flatMap((p) => botCommands(big, world, p.seat, "hard")),
  );

/** Six hard bots on Iron Delta for `ticks` log ticks, clearing the flow cache every `clearEvery` ticks when given. */
function play(ticks: number, clearEvery = 0): World {
  clearFlowCache(big);
  let world = createWorld(big, SEATS, 5);
  for (let tick = 0; tick < ticks && world.winner === NO_WINNER; tick++) {
    if (clearEvery > 0 && tick % clearEvery === 0) clearFlowCache(big);
    world = botTick(world);
  }
  return world;
}

test("a big-map match is the same whether its flow cache is kept or keeps being dropped", () => {
  assert.equal(hashWorld(play(240, 7)), hashWorld(play(240)));
});

test("A full army (6 × 48 = 288 units, the cap) on the largest map steps and roll back 40 ticks inside a generous budget", () => {
  let world = createWorld(big, SEATS, 9);
  const units = [...world.units];
  for (const seat of SEATS) {
    const fort = big.sites.find(
      (site) => site.kind === "fort" && site.seat === seat,
    )!;
    const kind = seat % 3 === 2 ? "lightTank" : "grunt";
    for (let i = 0; i < UNIT_CAP; i++)
      units.push({
        id: world.nextId + units.length,
        kind,
        owner: seat,
        x: centreOf(fort.door.x),
        y: centreOf(fort.door.y),
        hp: UNITS[kind].hp,
        cooldown: 0,
        goal: -1,
        stun: 0,
        rally: 0,
      });
  }
  world = { ...world, units, nextId: world.nextId + units.length };
  assert.equal(world.units.length, 288);
  // Warm up: the fields every stance needs, as a running match has them.
  for (let tick = 0; tick < 20; tick++) world = botTick(world);
  const saved = encodeWorld(world);
  let started = performance.now();
  for (let tick = 0; tick < 40; tick++) world = botTick(world);
  const forward = performance.now() - started;
  const restored = decodeWorld(saved, big)!;
  started = performance.now();
  let replay = restored;
  for (let tick = 0; tick < 40; tick++) replay = botTick(replay);
  const rollback = performance.now() - started;
  assert.equal(
    hashWorld(replay),
    hashWorld(world),
    "the re-run lands where the first run did",
  );
  log(
    `Iron Delta, ${world.units.length} units: ${(forward / 40).toFixed(2)} ms a tick, 40-tick rollback re-run ${rollback.toFixed(0)} ms`,
  );
  assert.ok(
    forward < 4000 && rollback < 4000,
    `${forward.toFixed(0)} / ${rollback.toFixed(0)} ms`,
  );
});

test("loading the largest map, sectors and all, stays fast", () => {
  const file = generate(TEMPLATES["iron-delta"]!);
  const started = performance.now();
  loadMap(file);
  const elapsed = performance.now() - started;
  log(`Iron Delta loads in ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 1000, `${elapsed.toFixed(0)} ms`);
});
