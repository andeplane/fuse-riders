import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAW,
  NO_WINNER,
  TURRET,
  UNITS,
  centreOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  hashWorld,
  step,
  stepTick,
  type CombatEvent,
  type GameMap,
  type UnitKind,
  type World,
  viewOf,
} from "../src/engine/index.js";
import { TINY, dustBasin, tiny } from "./fixtures/maps.js";

const map = tiny();

/** Adds a unit of `owner` at sub-pixel (x, y), or a tile's centre when given tiles. */
function add(
  world: World,
  owner: number,
  kind: UnitKind,
  x: number,
  y: number,
  hp = UNITS[kind].hp,
): World {
  const unit = {
    id: world.nextId,
    kind,
    owner,
    x,
    y,
    hp,
    cooldown: 0,
    goal: -1,
  };
  return { ...world, units: [...world.units, unit], nextId: world.nextId + 1 };
}
const at = (tile: number): number => centreOf(tile);

const shots = (world: World, from: number): CombatEvent[] =>
  world.events.filter((e) => e.type === "shot" && e.from.id === from);

const withBuilding = (world: World, id: number, hp: number): World => ({
  ...world,
  buildings: world.buildings.map((b) => (b.id === id ? { ...b, hp } : b)),
});

test("a unit shoots the nearest enemy in range, the lower id on a tie", () => {
  let world = createWorld(map, [0, 1], 1);
  world = add(world, 0, "grunt", at(6), at(7)); // 1
  world = add(world, 1, "grunt", at(8), at(7)); // 2
  world = add(world, 1, "grunt", at(4), at(7)); // 3: as far as 2
  let next = step(map, world);
  assert.equal(shots(next, 1).length, 1);
  assert.deepEqual(shots(next, 1)[0], {
    type: "shot",
    from: { building: false, id: 1, x: at(6), y: at(7) },
    to: { building: false, id: 2, x: at(8), y: at(7) },
    damage: UNITS.grunt.damage,
  });
  world = add(world, 1, "torch", at(6), at(8)); // 4: one tile away
  next = step(map, world);
  assert.equal((shots(next, 1)[0] as { to: { id: number } }).to.id, 4);
});

test("range is inclusive to the sub-pixel, and a unit out of range keeps walking", () => {
  const base = add(createWorld(map, [0, 1], 1), 0, "grunt", at(3), at(7));
  const reach = at(3) + UNITS.grunt.range;
  const inRange = step(map, add(base, 1, "lightTank", reach, at(7)));
  assert.equal(shots(inRange, 1).length, 1);
  const beyond = step(map, add(base, 1, "lightTank", reach + 1, at(7)));
  assert.equal(shots(beyond, 1).length, 0);
  assert.notDeepEqual(
    [beyond.units[0]!.x, beyond.units[0]!.y],
    [at(3), at(7)],
    "out of range it walks its stance",
  );
});

test("a shooter fires every `cooldown` steps and stands still while it fights", () => {
  let world = add(createWorld(map, [0, 1], 1), 0, "grunt", at(5), at(7));
  world = add(world, 1, "lightTank", at(8), at(7));
  const fired: number[] = [];
  for (let index = 0; index < 90; index++) {
    world = step(map, world);
    if (shots(world, 1).length > 0) fired.push(world.step);
    assert.deepEqual([world.units[0]!.x, world.units[0]!.y], [at(5), at(7)]);
  }
  const cadence = UNITS.grunt.cooldown;
  assert.deepEqual(fired, [1, 1 + cadence, 1 + 2 * cadence]);
  assert.equal(
    world.units.find((u) => u.id === 2)!.hp,
    UNITS.lightTank.hp - 3 * UNITS.grunt.damage,
  );
});

test("a held turret fires at enemies; a neutral one neither fires nor is shot", () => {
  const neutral = add(createWorld(map, [0, 1], 1), 1, "grunt", at(9), at(6));
  const idle = step(map, neutral);
  assert.equal(shots(idle, TINY.turret).length, 0);
  assert.equal(shots(idle, 1).length, 0, "nothing else is in its range");
  const held = {
    ...neutral,
    sectors: neutral.sectors.map((o, i) => (i === TINY.middle ? 0 : o)),
  };
  const next = step(map, held);
  const [shot] = next.events.filter(
    (e) => e.type === "shot" && e.from.building,
  );
  assert.deepEqual(shot, {
    type: "shot",
    from: { building: true, id: TINY.turret, x: at(6), y: at(6) },
    to: { building: false, id: 1, x: at(9), y: at(6) },
    damage: TURRET.damage,
  });
  // The grunt shoots back at the turret at its siege rate.
  const [back] = shots(next, 1);
  assert.equal(
    (back as { damage: number }).damage,
    (UNITS.grunt.damage * UNITS.grunt.siege) / 100,
  );
  const turret = next.buildings.find((b) => b.id === TINY.turret)!;
  assert.equal(turret.cooldown, TURRET.cooldown);
});

test("a destroyed turret is a ruin: it stops firing and is no longer a target", () => {
  let world = add(createWorld(map, [0, 1], 1), 1, "grunt", at(9), at(6));
  world = withBuilding(
    {
      ...world,
      sectors: world.sectors.map((o, i) => (i === TINY.middle ? 0 : o)),
    },
    TINY.turret,
    1,
  );
  world = step(map, world);
  assert.deepEqual(
    world.events.filter((e) => e.type === "destroyed"),
    [{ type: "destroyed", building: TINY.turret, kind: "turret" }],
  );
  // It still fired on the step it fell: shots resolve together.
  assert.equal(shots(world, TINY.turret).length, 1);
  for (let index = 0; index < 40; index++) {
    world = step(map, world);
    assert.equal(world.events.filter((e) => e.type === "shot").length, 0);
  }
  assert.equal(world.buildings.find((b) => b.id === TINY.turret)!.hp, 0);
});

test("units that die on one step all fire first, then leave in id order", () => {
  let world = createWorld(map, [0, 1], 1);
  world = add(world, 0, "grunt", at(4), at(7)); // 1 near 3
  world = add(world, 1, "grunt", at(9), at(7), 1); // 2
  world = add(world, 1, "grunt", at(5), at(7), 1); // 3
  world = add(world, 0, "grunt", at(10), at(7)); // 4 near 2
  const next = step(map, world);
  assert.deepEqual(
    next.events
      .filter((e) => e.type === "death")
      .map((e) => e.type === "death" && e.id),
    [2, 3],
  );
  assert.equal(shots(next, 2).length + shots(next, 3).length, 2);
  assert.deepEqual(
    next.units.map((u) => [u.id, u.hp]),
    [
      [1, UNITS.grunt.hp - UNITS.grunt.damage],
      [4, UNITS.grunt.hp - UNITS.grunt.damage],
    ],
  );
});

test("PUSH with every flag taken marches on the enemy fort, and its fall wins the match", () => {
  let world = createWorld(map, [0, 1], 1);
  world = { ...world, sectors: world.sectors.map(() => 0) };
  world = add(world, 0, "lightTank", at(4), at(5));
  world = withBuilding(world, TINY.fort1, 30);
  world = step(map, world);
  assert.equal(world.units[0]!.goal, 1 * map.width + 12, "the goal is fort 1");
  let ticks = 0;
  while (world.winner === NO_WINNER && ticks++ < 400)
    world = stepTick(map, world);
  assert.equal(world.winner, 0);
  assert.deepEqual(
    world.events.filter((e) => e.type !== "shot"),
    [
      { type: "destroyed", building: TINY.fort1, kind: "fort" },
      { type: "won", winner: 0 },
    ],
  );
  // After the win only the clock moves: no commands, no fire, no production.
  const after = stepTick(map, world, [
    { seat: 1, type: "stance", stance: "hold" },
  ]);
  assert.equal(after.step, world.step + 2);
  assert.deepEqual(after.events, []);
  assert.deepEqual(
    encodeWorld({ ...after, step: world.step }),
    encodeWorld(world),
  );
});

test("both teams losing their last fort on one step is a draw; one team alone never wins", () => {
  let world = createWorld(map, [0, 1], 1);
  world = withBuilding(withBuilding(world, TINY.fort0, 1), TINY.fort1, 1);
  world = add(world, 1, "grunt", at(2), at(1));
  world = add(world, 0, "grunt", at(11), at(1));
  world = step(map, world);
  assert.equal(world.winner, DRAW);
  assert.equal(step(map, createWorld(map, [0, 2], 1)).winner, NO_WINNER);
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const each of Object.values(value)) deepFreeze(each);
    Object.freeze(value);
  }
  return value;
};

test("fighting and won steps leave the world they are given untouched", () => {
  let world = createWorld(map, [0, 1], 1);
  world = {
    ...world,
    sectors: world.sectors.map((o, i) => (i === TINY.middle ? 0 : o)),
  };
  world = withBuilding(world, TINY.fort1, 1);
  world = add(world, 1, "grunt", at(9), at(6), 1);
  world = add(world, 0, "torch", at(11), at(2));
  const frozen = deepFreeze(structuredClone(world));
  const next = stepTick(map, frozen);
  assert.deepEqual(frozen, world);
  assert.equal(next.winner, 0);
  assert.ok(next.events.some((e) => e.type === "death"));
  const won = deepFreeze(structuredClone(next));
  stepTick(map, won);
  assert.deepEqual(won, next);
});

test("a finished match round-trips through its checkpoint, events left out", () => {
  let world = createWorld(map, [0, 1, 2], 3);
  world = withBuilding(world, TINY.fort1, 1);
  world = add(world, 0, "grunt", at(11), at(2));
  world = step(map, world);
  assert.equal(world.winner, 0);
  assert.ok(world.events.length > 0);
  const view = viewOf(map, world);
  assert.equal(view.winner, 0);
  assert.deepEqual(view.events, world.events);
  assert.notEqual(view.events[0], world.events[0], "the view shares nothing");
  const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world))), map);
  assert.deepEqual(back, { ...world, events: [] });
  assert.equal(hashWorld(back!), hashWorld(world));
});

/** 300 units, 50 a seat, in two blocks facing each other west of Dust Basin's river. */
function brawl(dust: GameMap, seed: number): World {
  let world = createWorld(dust, [0, 1, 2, 3, 4, 5], seed);
  const block = (x0: number): number[] => {
    const tiles: number[] = [];
    for (let y = 16; y < 40; y++)
      for (let x = x0; x < x0 + 5; x++)
        if (dust.sectorOf[y * dust.width + x]! >= 0)
          tiles.push(y * dust.width + x);
    return tiles;
  };
  const blocks = [block(33), block(39)];
  for (let seat = 0; seat < 6; seat++)
    for (let index = 0; index < 50; index++) {
      const tiles = blocks[seat % 2]!;
      const tile = tiles[(index * 3 + (seat >> 1)) % tiles.length]!;
      const kind: UnitKind =
        index % 5 === 0 ? "lightTank" : index % 2 ? "torch" : "grunt";
      world = add(
        world,
        seat,
        kind,
        at(tile % dust.width),
        at(Math.floor(tile / dust.width)),
      );
    }
  return world;
}

test("a 300-unit brawl is deterministic and steps well inside a generous budget", () => {
  const dust = dustBasin();
  const run = (): { hash: string; events: string; ms: number } => {
    let world = brawl(dust, 4);
    const log: CombatEvent[] = [];
    const started = performance.now();
    for (let tick = 0; tick < 20; tick++) {
      world = stepTick(dust, world);
      log.push(...world.events);
    }
    return {
      hash: hashWorld(world),
      events: JSON.stringify(log),
      ms: performance.now() - started,
    };
  };
  const first = run(),
    second = run();
  assert.equal(second.hash, first.hash);
  assert.equal(second.events, first.events);
  assert.ok(first.events.includes('"death"'), "the brawl kills");
  assert.ok(first.ms < 3000, `${first.ms.toFixed(0)} ms`);
  if (process.env.PERF_LOG)
    console.log(`300-unit brawl × 40 steps: ${first.ms.toFixed(1)} ms`);
});
