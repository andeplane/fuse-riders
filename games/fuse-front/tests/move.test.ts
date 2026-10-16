import test from "node:test";
import assert from "node:assert/strict";
import {
  DIRS,
  FLOW_CACHE_SIZE,
  HOLD_RADIUS,
  STRAIGHT,
  UNITS,
  UNREACHABLE,
  buildFlowField,
  cachedFlowFields,
  centreOf,
  clearFlowCache,
  createWorld,
  flowField,
  hashWorld,
  loadMap,
  openTile,
  step,
  stepTick,
  teamSectors,
  tileOf,
  type Command,
  type GameMap,
  type Stance,
  type UnitKind,
  type World,
} from "../src/engine/index.js";
import { dustBasin, tiny } from "./fixtures/maps.js";

/** An 8 × 8 room with a 2 × 2 rock in the middle; or, with `island`, a water channel cutting off the south. */
const room = (island = false): GameMap =>
  loadMap({
    name: "Room",
    width: 8,
    height: 8,
    terrain: island
      ? ["########", "#......#", "#......#", "~~~~~~~~"].concat([
          "#......#",
          "#......#",
          "#......#",
          "########",
        ])
      : ["########", "#......#", "#......#", "#..##..#"].concat([
          "#..##..#",
          "#......#",
          "#......#",
          "########",
        ]),
    flags: [
      { x: 1, y: 1 },
      { x: 6, y: 6 },
    ],
    buildings: [],
    forts: [
      { seat: 0, x: 1, y: 2 },
      { seat: 1, x: 6, y: 5 },
    ],
  });

const at = (map: GameMap, x: number, y: number): number => y * map.width + x;

function place(
  world: World,
  owner: number,
  kind: UnitKind,
  tiles: readonly { x: number; y: number }[],
): World {
  let nextId = world.nextId;
  const units = [...world.units];
  for (const tile of tiles)
    units.push({
      id: nextId++,
      kind,
      owner,
      x: centreOf(tile.x),
      y: centreOf(tile.y),
      hp: UNITS[kind].hp,
      cooldown: 0,
      goal: -1,
    });
  return { ...world, units, nextId };
}

const stance = (seat: number, value: Stance): Command => ({
  seat,
  type: "stance",
  stance: value,
});

function run(
  map: GameMap,
  world: World,
  steps: number,
  each?: (w: World) => void,
): World {
  let next = world;
  for (let index = 0; index < steps; index++) {
    next = step(map, next);
    each?.(next);
  }
  return next;
}

test("a flow field walks around rock without cutting its corners", () => {
  const map = room();
  const goal = at(map, 5, 3);
  const field = buildFlowField(map, goal);
  assert.equal(field.cost[goal], 0);
  assert.equal(field.cost[at(map, 3, 3)], UNREACHABLE);
  // Left of the rock to right of it: up and over in five straight steps (a cut corner would make it 38).
  assert.equal(field.cost[at(map, 2, 3)], 5 * STRAIGHT);
  for (let tile = 0; tile < map.width * map.height; tile++) {
    if (field.cost[tile] === UNREACHABLE) {
      assert.equal(field.next[tile], -1);
      continue;
    }
    let here = tile;
    while (here !== goal) {
      const [dx, dy] = DIRS[field.next[here]!]!;
      const x = here % map.width,
        y = (here - x) / map.width;
      assert.ok(openTile(map, x + dx, y + dy));
      assert.ok(
        openTile(map, x + dx, y) && openTile(map, x, y + dy),
        "no corner cut",
      );
      const next = at(map, x + dx, y + dy);
      assert.ok(field.cost[next]! < field.cost[here]!);
      here = next;
    }
  }
});

test("an unreachable goal leaves every tile across the water unreachable, and no unit wades in", () => {
  const map = room(true);
  const field = buildFlowField(map, at(map, 6, 6));
  assert.equal(field.cost[at(map, 1, 1)], UNREACHABLE);
  assert.equal(field.next[at(map, 1, 1)], -1);
  // Seat 0 pushes, but the only flag to take lies across the water: it holds its own instead.
  let world = place(createWorld(map, [0, 1], 3), 0, "grunt", [{ x: 5, y: 2 }]);
  world = run(map, world, 200);
  const unit = world.units[0]!;
  assert.equal(unit.goal, at(map, 1, 1));
  assert.equal(tileOf(unit.y) < 3, true);
});

test("cached fields match fresh ones and the cache stays bounded", () => {
  const map = dustBasin();
  clearFlowCache(map);
  let asked = 0;
  for (let tile = 0; tile < map.width * map.height; tile += 37)
    if (map.sectorOf[tile]! >= 0) asked += flowField(map, tile) ? 1 : 0;
  assert.ok(asked > FLOW_CACHE_SIZE);
  assert.equal(cachedFlowFields(map), FLOW_CACHE_SIZE);
  const goal = at(map, map.flags[3]!.x, map.flags[3]!.y);
  assert.deepEqual(flowField(map, goal), buildFlowField(map, goal));
});

test("units never stand on or step through blocked ground over a long six-seat run", () => {
  const map = dustBasin();
  let world = createWorld(map, [0, 1, 2, 3, 4, 5], 11);
  const script = new Map<number, Command[]>([
    [1, [stance(1, "hold"), stance(2, "follow")]],
    [500, [stance(1, "push"), stance(3, "hold")]],
  ]);
  let checked = 0;
  for (let tick = 1; tick <= 1200; tick++) {
    world = stepTick(map, world, script.get(tick) ?? []);
    for (const unit of world.units) {
      assert.ok(
        openTile(map, tileOf(unit.x), tileOf(unit.y)),
        `unit ${unit.id} on blocked ground`,
      );
      checked++;
    }
  }
  assert.ok(checked > 10_000);
  assert.ok(
    world.sectors.filter((owner) => owner >= 0).length > 6,
    "pushing takes flags",
  );
});

test("a pushing robot walks to the nearest neutral flag and takes it, then the next", () => {
  const map = tiny();
  let world = place(createWorld(map, [0, 1], 5), 0, "grunt", [map.flags[0]!]);
  assert.equal(teamSectors(world, 0), 1);
  world = run(map, world, 200);
  assert.ok(teamSectors(world, 0) >= 2);
  world = run(map, world, 400);
  assert.ok(teamSectors(world, 0) >= 3);
});

test("holding units gather near their team's flags, spread over them, and take nothing", () => {
  const map = tiny();
  let world = createWorld(map, [0, 1], 5);
  // Seat 0 holds the west home and the south-west.
  world = {
    ...world,
    sectors: world.sectors.map((owner, flag) => (flag === 3 ? 0 : owner)),
  };
  const spots = [1, 2, 4, 6, 7, 8].map((y) => ({ x: 5, y }));
  world = place(world, 0, "grunt", spots);
  world = step(map, world, [stance(0, "hold")]);
  world = run(map, world, 400);
  const homes = [0, 3].map((flag) =>
    at(map, map.flags[flag]!.x, map.flags[flag]!.y),
  );
  for (const unit of world.units) {
    const cost = Math.min(
      ...homes.map(
        (home) =>
          flowField(map, home).cost[at(map, tileOf(unit.x), tileOf(unit.y))]!,
      ),
    );
    assert.ok(
      cost <= HOLD_RADIUS + STRAIGHT,
      `unit ${unit.id} strayed ${cost}`,
    );
  }
  for (const home of homes)
    assert.ok(
      world.units.some((unit) => unit.goal === home),
      "both flags are held",
    );
  assert.equal(teamSectors(world, 0), 2);
});

test("separation parts units stacked on one sub-pixel", () => {
  const map = tiny();
  let world = place(
    createWorld(map, [0, 1], 5),
    0,
    "grunt",
    Array(8).fill(map.flags[0]!),
  );
  world = step(map, world, [stance(0, "hold")]);
  world = run(map, world, 40);
  for (const [index, a] of world.units.entries())
    for (const b of world.units.slice(index + 1)) {
      const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      assert.ok(
        d2 >= (2 * UNITS.grunt.radius - 4) ** 2,
        `units ${a.id} and ${b.id} overlap`,
      );
    }
});

test("movement is deterministic, and a cold cache gives what a warm one does", () => {
  const map = dustBasin();
  const play = (cold: boolean): string => {
    let world = createWorld(map, [0, 1, 2, 3], 21);
    for (let tick = 1; tick <= 400; tick++) {
      if (cold && tick % 10 === 0) clearFlowCache(map);
      world = stepTick(
        map,
        world,
        tick === 200 ? [stance(0, "hold"), stance(1, "follow")] : [],
      );
    }
    assert.ok(world.units.length > 10);
    return hashWorld(world);
  };
  const warm = play(false);
  assert.equal(play(false), warm);
  assert.equal(play(true), warm);
});

test("300 units step 40 times well inside a generous budget", () => {
  const map = dustBasin();
  let world = createWorld(map, [0, 1, 2, 3, 4, 5], 9);
  for (const seat of [0, 1, 2, 3, 4, 5]) {
    const fort = map.sites.find(
      (site) => site.kind === "fort" && site.seat === seat,
    )!;
    world = place(
      world,
      seat,
      seat % 3 === 2 ? "lightTank" : "grunt",
      Array(50).fill(fort.door),
    );
  }
  assert.equal(world.units.length, 300);
  const started = performance.now();
  world = run(map, world, 40);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3000, `${elapsed.toFixed(0)} ms`);
  if (process.env.PERF_LOG)
    console.log(`300 units × 40 steps: ${elapsed.toFixed(1)} ms`);
});
