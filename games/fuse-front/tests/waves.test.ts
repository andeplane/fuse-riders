import test from "node:test";
import assert from "node:assert/strict";
import {
  FOLLOW_HERO,
  NEUTRAL,
  NO_WINNER,
  STEPS_PER_SECOND,
  UNITS,
  WAVE_CAP,
  WAVE_EVERY,
  WAVE_FIRST,
  WAVE_GROWTH_MAX,
  aheadOf,
  centreOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  hashWorld,
  laneGoal,
  laneOwner,
  seatLane,
  spawnWaves,
  step,
  tileOf,
  traceLine,
  waveAt,
  waveGrowth,
  waveHp,
  waypoints,
  type GameMap,
  type Unit,
  type World,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import { benchHeroes } from "./fixtures/heroes.js";
import { dustBasin } from "./fixtures/maps.js";

const twin = mapById("twin-wilds");
/** A 1v1 on the 2v2 lane map at `at` steps, nothing spawned yet. */
const duel = (at = 0): World => ({ ...createWorld(twin, [0, 1], 1), step: at });
const waveOf = (world: World, team: number, lane: number): Unit[] =>
  world.units.filter((u) => u.owner % 2 === team && u.lane === lane);

test("a wave every 30 seconds from the fifth: three grunts and a torch per lane and team, at the team's end", () => {
  assert.equal(waveAt(WAVE_FIRST - 1), 0);
  assert.equal(waveAt(WAVE_FIRST), 1);
  assert.equal(waveAt(WAVE_FIRST + 1), 0);
  assert.equal(waveAt(WAVE_FIRST + 4 * WAVE_EVERY), 5);
  assert.equal(WAVE_EVERY, 30 * STEPS_PER_SECOND);
  const world = duel(WAVE_FIRST);
  spawnWaves(twin, world);
  assert.equal(world.units.length, 2 * 3 * 4);
  for (const team of [0, 1])
    for (const [lane, path] of twin.lanes.entries()) {
      const units = waveOf(world, team, lane);
      assert.deepEqual(units.map((u) => u.kind).sort(), [
        "grunt",
        "grunt",
        "grunt",
        "torch",
      ]);
      const start = waypoints(path, team)[0]!;
      for (const u of units) {
        assert.equal(u.owner, team, "a lone rider owns every lane's wave");
        assert.deepEqual([tileOf(u.x), tileOf(u.y)], [start.x, start.y]);
        assert.equal(u.wave, 1);
        assert.equal(u.hp, UNITS[u.kind].hp);
      }
    }
  // Nothing spawns between waves.
  const later = { ...world, step: WAVE_FIRST + 1, units: [...world.units] };
  spawnWaves(twin, later);
  assert.equal(later.units.length, 24);
});

test("waves grow tougher with their number, up to the cap on growth", () => {
  assert.equal(waveGrowth(1), 100);
  assert.ok(waveGrowth(11) > waveGrowth(10));
  assert.equal(waveGrowth(1000), 100 + WAVE_GROWTH_MAX);
  const world = duel(WAVE_FIRST + 20 * WAVE_EVERY);
  spawnWaves(twin, world);
  const grunt = world.units.find((u) => u.kind === "grunt")!;
  assert.equal(grunt.wave, 21);
  assert.equal(grunt.hp, waveHp("grunt", 21));
  assert.ok(grunt.hp > UNITS.grunt.hp);
});

test("a team at the wave cap sends only what fits under it", () => {
  const world = duel(WAVE_FIRST);
  spawnWaves(twin, world);
  // Pad team 0 to two under the cap with copies of its first grunt.
  const grunt = world.units[0]!;
  while (world.units.filter((u) => u.owner === 0).length < WAVE_CAP - 2)
    world.units.push({ ...grunt, id: world.nextId++ });
  world.step = WAVE_FIRST + WAVE_EVERY;
  const before = world.units.length;
  spawnWaves(twin, world);
  const added = world.units.slice(before);
  assert.equal(added.filter((u) => u.owner === 0).length, 2);
  assert.equal(added.filter((u) => u.owner === 1).length, 12);
});

test("lanes go to seats: one rider takes mid's waypoints, two take top and bot, three one each", () => {
  const three = mapById("crown-jungle");
  const names = (map: GameMap, world: World) =>
    world.players.map((p) => map.lanes[seatLane(map, world, p.seat)]!.name);
  assert.deepEqual(names(twin, duel()), ["mid", "mid"]);
  assert.deepEqual(names(twin, createWorld(twin, [0, 1, 2, 3], 1)), [
    "top",
    "top",
    "bot",
    "bot",
  ]);
  const full = createWorld(three, [0, 1, 2, 3, 4, 5], 1);
  assert.deepEqual(names(three, full), [
    "top",
    "top",
    "mid",
    "mid",
    "bot",
    "bot",
  ]);
  // A lane nobody plays sends its wave for the team's lowest seat.
  const pair = createWorld(twin, [0, 1, 2, 3], 1);
  assert.equal(laneOwner(twin, pair, 0, 1), 0);
  assert.equal(laneOwner(twin, pair, 1, 2), 3);
});

test("a lane walker heads for the first waypoint it has neither reached nor passed", () => {
  const path = twin.lanes.find((lane) => lane.name === "top")!.path;
  const at = (i: number) => [centreOf(path[i]!.x), centreOf(path[i]!.y)];
  assert.equal(aheadOf(path, at(0)[0]!, at(0)[1]!), 1);
  // Halfway along the first leg it heads for the second waypoint.
  const half = [(at(0)[0]! + at(1)[0]!) / 2, (at(0)[1]! + at(1)[1]!) / 2];
  assert.equal(aheadOf(path, half[0]!, half[1]!), 1);
  assert.equal(aheadOf(path, at(1)[0]!, at(1)[1]!), 2);
  const end = path.length - 1;
  assert.equal(aheadOf(path, at(end)[0]!, at(end)[1]!), path.length);
});

test("a later wave's unit above its wave's hit points is refused", () => {
  const world = duel(WAVE_FIRST + 20 * WAVE_EVERY);
  spawnWaves(twin, world);
  const wire = structuredClone(encodeWorld(world)) as unknown[];
  assert.ok(decodeWorld(structuredClone(wire), twin));
  (wire[6] as number[][])[0]![5] = waveHp("grunt", 21) + 1;
  assert.equal(decodeWorld(wire, twin), undefined);
});

test("a step on a lane map leaves the world it was given untouched", () => {
  let world = createWorld(twin, [0, 1, 2, 3], 2);
  for (let index = 0; index < WAVE_FIRST + 600; index++)
    world = step(twin, world);
  const before = JSON.stringify(encodeWorld(world));
  step(twin, world);
  assert.equal(JSON.stringify(encodeWorld(world)), before);
});

test("past its lane's end a wave makes for the enemy fort, and it turns to an enemy fort in sight", () => {
  const world = duel(WAVE_FIRST);
  spawnWaves(twin, world);
  const unit = waveOf(world, 0, 1)[0]!;
  const fort = twin.sites.find((s) => s.kind === "fort" && s.seat === 1)!;
  const fortTile = fort.y * twin.width + fort.x;
  const end = twin.lanes[1]!.path.at(-1)!;
  Object.assign(unit, { x: centreOf(end.x), y: centreOf(end.y) });
  const none = () => false;
  assert.equal(laneGoal(twin, world, unit, none), fortTile);
  // Back at the start it heads down the lane, unless a siegeable structure is in sight (here its own fort, to test).
  const start = twin.lanes[1]!.path[0]!;
  Object.assign(unit, { x: centreOf(start.x), y: centreOf(start.y) });
  const next = twin.lanes[1]!.path[1]!;
  assert.equal(laneGoal(twin, world, unit, none), next.y * twin.width + next.x);
  const own = twin.sites.find((s) => s.kind === "fort" && s.seat === 0)!;
  Object.assign(unit, { x: centreOf(own.x + 4), y: centreOf(own.y) });
  const ownIndex = world.buildings.findIndex((b) => b.id === own.id);
  assert.equal(
    laneGoal(twin, world, unit, (index) => index === ownIndex),
    own.y * twin.width + own.x,
  );
});

/** Tiles within `reach` (either axis) of a lane's straight legs. */
function corridor(map: GameMap, lane: number, reach: number): Set<number> {
  const tiles = new Set<number>();
  const path = map.lanes[lane]!.path;
  for (let i = 1; i < path.length; i++)
    traceLine(path[i - 1]!, path[i]!, (x, y) => {
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++)
          tiles.add((y + dy) * map.width + x + dx);
      return true;
    });
  return tiles;
}

test("waves walk their lanes without wandering into the jungle, and turn the corners", () => {
  let world = benchHeroes(createWorld(twin, [0, 1], 1));
  const corridors = twin.lanes.map((_, lane) => corridor(twin, lane, 3));
  let turned = false;
  for (let index = 0; index < WAVE_FIRST + 70 * STEPS_PER_SECOND; index++) {
    world = step(twin, world);
    for (const u of world.units) {
      // The jungle camps' guards (`jungle.ts`) stand off the lanes.
      if (u.lane < 0) continue;
      const tile = tileOf(u.y) * twin.width + tileOf(u.x);
      assert.ok(corridors[u.lane]!.has(tile), `unit ${u.id} left its lane`);
      const path = waypoints(twin.lanes[u.lane]!, u.owner % 2);
      if (path.length > 2 && aheadOf(path, u.x, u.y) >= 2) turned = true;
    }
  }
  assert.ok(turned, "a top or bot wave rounds its corner");
  assert.ok(world.units.length > 24);
});

test("lane maps build nothing in factories; maps without lanes keep their factories and send no waves", () => {
  let world = createWorld(twin, [0, 1], 1);
  for (let index = 0; index < WAVE_FIRST; index++) world = step(twin, world);
  assert.ok(world.units.every((u) => u.lane >= 0 || u.owner === NEUTRAL));
  assert.ok(world.buildings.every((b) => b.progress === 0));
  const basin = dustBasin();
  let old = createWorld(basin, [0, 1], 1);
  for (let index = 0; index < WAVE_FIRST + 30 * STEPS_PER_SECOND; index++)
    old = step(basin, old);
  assert.ok(old.units.length > 0);
  assert.ok(old.units.every((u) => u.lane === -1 && u.wave === 0));
});

test("a match with waves round-trips its checkpoint, and runs the same from it", () => {
  let world = createWorld(twin, [0, 1], 3);
  for (let index = 0; index < WAVE_FIRST + 40 * STEPS_PER_SECOND; index++)
    world = step(twin, world);
  assert.equal(world.winner, NO_WINNER);
  const decoded = decodeWorld(
    JSON.parse(JSON.stringify(encodeWorld(world))),
    twin,
  );
  assert.ok(decoded);
  let [a, b] = [world, decoded];
  for (let index = 0; index < 200; index++)
    [a, b] = [step(twin, a), step(twin, b)];
  assert.equal(hashWorld(a), hashWorld(b));
});

/** A checkpoint's units (field 6) as tuples, and the whole wire to change the next id (field 2). */
const corruptions: [string, (units: number[][], wire: unknown[]) => void][] = [
  ["a wave not yet sent", (u) => (u[0]![11] = 3)],
  ["a lane unit of no wave", (u) => (u[0]![11] = 0)],
  ["a wave unit off every lane", (u) => (u[0]![10] = -1)],
  ["a lane the map lacks", (u) => (u[0]![10] = twin.lanes.length)],
  ["a wave grunt above its wave's hit points", (u) => (u[0]![5] = 61)],
  ["a sentry in a lane", (u) => (u[0]![1] = 3)],
  [
    "a stance's unit bound for a waypoint",
    (u) => {
      const end = twin.lanes[1]!.path.at(-1)!;
      [u[0]![10], u[0]![11], u[0]![7]] = [-1, 0, end.y * twin.width + end.x];
    },
  ],
  ["a wave unit following its hero", (u) => (u[0]![7] = FOLLOW_HERO)],
  [
    "a team over the wave cap",
    (units, wire) => {
      const unit = units[0]!;
      units.length = 0;
      for (let id = 1; id <= WAVE_CAP + 1; id++)
        units.push([id, ...unit.slice(1)]);
      wire[2] = WAVE_CAP + 2;
    },
  ],
];

for (const [label, corrupt] of corruptions)
  test(`a checkpoint with ${label} is refused`, () => {
    const world = duel(WAVE_FIRST + WAVE_EVERY);
    // Two waves sent: the first unit is a wave-1 grunt.
    world.step = WAVE_FIRST;
    spawnWaves(twin, world);
    world.step = WAVE_FIRST + WAVE_EVERY;
    const wire = structuredClone(encodeWorld(world)) as unknown[];
    assert.ok(decodeWorld(structuredClone(wire), twin), "the base decodes");
    const units = wire[6] as number[][];
    assert.equal(units[0]![1], 0, "a grunt");
    corrupt(units, wire);
    assert.equal(decodeWorld(wire, twin), undefined);
  });
