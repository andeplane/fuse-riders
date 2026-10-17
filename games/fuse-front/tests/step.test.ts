import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOCK_MAX,
  COMMANDS_PER_SEAT,
  TILE,
  UNITS,
  UNIT_CAP,
  buildSteps,
  centreOf,
  clockRate,
  createWorld,
  hashWorld,
  imul,
  step,
  stepTick,
  teamSectors,
  viewOf,
  type Command,
  type GameMap,
  type UnitKind,
  type World,
} from "../src/engine/index.js";
import { TINY, dustBasin, tiny } from "./fixtures/maps.js";

/** A world with `kind` units of `owner` placed on a tile, ids continuing the world's. */
function place(
  world: World,
  owner: number,
  kind: UnitKind,
  tile: { x: number; y: number },
  count = 1,
): World {
  const units = [...world.units];
  let nextId = world.nextId;
  for (let index = 0; index < count; index++)
    units.push({
      id: nextId++,
      kind,
      owner,
      x: centreOf(tile.x),
      y: centreOf(tile.y),
      hp: UNITS[kind].hp,
      cooldown: 0,
    });
  return { ...world, units, nextId };
}

const run = (map: GameMap, world: World, steps: number): World => {
  let next = world;
  for (let index = 0; index < steps; index++) next = step(map, next);
  return next;
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const each of Object.values(value)) deepFreeze(each);
    Object.freeze(value);
  }
  return value;
};

test("a fresh world: each seat holds its fort's home sector, everything else is neutral", () => {
  const map = dustBasin();
  const world = createWorld(map, [1, 0], 7);
  assert.deepEqual(
    world.players.map((p) => [p.seat, p.team, p.stance]),
    [
      [0, 0, "push"],
      [1, 1, "push"],
    ],
  );
  const owned = world.sectors.flatMap((owner, sector) =>
    owner >= 0 ? [[sector, owner]] : [],
  );
  assert.equal(owned.length, 2);
  for (const [sector, seat] of owned)
    assert.ok(
      map.sites.some(
        (s) => s.kind === "fort" && s.seat === seat && s.sector === sector,
      ),
    );
  // Only the forts of the seats in play stand.
  assert.equal(world.buildings.length, map.sites.length - 4);
  assert.throws(() => createWorld(map, [0], 1), /two or more/);
  assert.throws(() => createWorld(tiny(), [0, 3], 1), /no fort for seat 3/);
});

test("a robot on a flag takes the sector; a tank does not", () => {
  const map = tiny();
  const world = createWorld(map, [0, 1], 1);
  const flag = map.flags[TINY.middle]!;
  assert.equal(
    step(map, place(world, 0, "lightTank", flag)).sectors[TINY.middle],
    -1,
  );
  assert.equal(
    step(map, place(world, 0, "torch", flag)).sectors[TINY.middle],
    0,
  );
  const taken = step(map, place(world, 1, "grunt", flag));
  assert.equal(taken.sectors[TINY.middle], 1);
  // Standing one tile off the flag takes nothing.
  assert.equal(
    step(map, place(world, 0, "grunt", { x: flag.x + 1, y: flag.y + 1 }))
      .sectors[TINY.middle],
    -1,
  );
});

test("capture: an enemy home flag flips, a teammate's does not, and a contested flag holds", () => {
  const map = tiny();
  const world = createWorld(map, [0, 1, 2], 1);
  const home0 = map.flags[map.sites[TINY.fort0]!.sector]!;
  assert.equal(step(map, place(world, 1, "grunt", home0)).sectors[0], 1);
  // Seat 2 is seat 0's teammate: re-taking a teammate's flag is a no-op.
  assert.equal(step(map, place(world, 2, "grunt", home0)).sectors[0], 0);
  const middle = map.flags[TINY.middle]!;
  const contested = place(place(world, 0, "grunt", middle), 1, "grunt", middle);
  assert.equal(step(map, contested).sectors[TINY.middle], -1);
  // Teammates together are no contest: the lower id takes it.
  const together = place(place(world, 2, "grunt", middle), 0, "grunt", middle);
  assert.equal(step(map, together).sectors[TINY.middle], 2);
});

test("a captured factory builds its default order at the team's clock and spawns the batch at its door", () => {
  const map = tiny();
  let world = step(
    map,
    place(createWorld(map, [0, 1], 1), 0, "grunt", map.flags[TINY.middle]!),
  );
  assert.equal(world.sectors[TINY.middle], 0);
  const factory = () =>
    world.buildings.find((b) => b.id === TINY.robotFactory)!;
  assert.equal(factory().order, "grunt");
  assert.equal(teamSectors(world, 0), 2);
  const steps = buildSteps("grunt", 2);
  // The capture step already worked one step of the batch.
  world = run(map, world, steps - 2);
  assert.equal(world.units.length, 1);
  world = step(map, world);
  const spawned = world.units.slice(1);
  assert.equal(spawned.length, UNITS.grunt.batch);
  const door = map.sites[TINY.robotFactory]!.door;
  for (const unit of spawned) {
    assert.equal(unit.owner, 0);
    assert.equal(unit.kind, "grunt");
    assert.equal(Math.floor(unit.x / TILE), door.x);
    assert.equal(Math.floor(unit.y / TILE), door.y);
  }
  assert.deepEqual(
    spawned.map((u) => u.id),
    [2, 3, 4],
  );
  assert.equal(factory().progress, 0);
  // Neutral factories idle.
  assert.equal(
    world.buildings.find((b) => b.id === TINY.vehicleFactory)!.progress,
    0,
  );
});

test("the production clock speeds up with team sectors and never below half the base time", () => {
  assert.equal(clockRate(0), 100);
  assert.equal(clockRate(1), 100);
  assert.equal(clockRate(2), 115);
  assert.equal(clockRate(40), CLOCK_MAX);
  for (const kind of ["grunt", "torch", "lightTank"] as const) {
    assert.equal(buildSteps(kind, 1), UNITS[kind].build);
    assert.equal(buildSteps(kind, 30), UNITS[kind].build / 2);
    for (let sectors = 1; sectors < 12; sectors++)
      assert.ok(buildSteps(kind, sectors + 1) <= buildSteps(kind, sectors));
  }
  assert.equal(
    buildSteps("grunt", 2),
    Math.ceil((UNITS.grunt.build * 100) / 115),
  );
});

test("a player at the unit cap pauses, and a batch is cut to the room left under the cap", () => {
  const map = tiny();
  const parking = { x: 12, y: 4 };
  let world = step(
    map,
    place(createWorld(map, [0, 1], 1), 0, "grunt", map.flags[TINY.middle]!),
  );
  world = place(world, 0, "grunt", parking, UNIT_CAP - 2);
  world = run(map, world, buildSteps("grunt", 2));
  assert.equal(world.units.filter((u) => u.owner === 0).length, UNIT_CAP);
  const paused = run(map, world, 50);
  assert.equal(paused.units.length, world.units.length);
  assert.deepEqual(paused.buildings, world.buildings);
});

test("orders and stances: only the owner orders its factory, only kinds it builds, and a change restarts it", () => {
  const map = tiny();
  let world = step(
    map,
    place(createWorld(map, [0, 1], 1), 0, "grunt", map.flags[TINY.middle]!),
  );
  world = run(map, world, 10);
  const factory = (w: World) =>
    w.buildings.find((b) => b.id === TINY.robotFactory)!;
  const before = factory(world);
  const send = (...commands: Command[]) => step(map, world, commands);
  const kept = (w: World) => assert.equal(factory(w).order, "grunt");
  kept(
    send({ seat: 1, type: "order", factory: TINY.robotFactory, kind: "torch" }),
  );
  kept(
    send({ seat: 4, type: "order", factory: TINY.robotFactory, kind: "torch" }),
  );
  kept(
    send({
      seat: 0,
      type: "order",
      factory: TINY.robotFactory,
      kind: "lightTank",
    }),
  );
  kept(send({ seat: 0, type: "order", factory: 99, kind: "torch" }));
  // An unowned vehicle factory and the turret take no orders.
  const tank = send({
    seat: 0,
    type: "order",
    factory: TINY.vehicleFactory,
    kind: "lightTank",
  });
  assert.equal(
    tank.buildings.find((b) => b.id === TINY.vehicleFactory)!.progress,
    0,
  );
  const torch = send({
    seat: 0,
    type: "order",
    factory: TINY.robotFactory,
    kind: "torch",
  });
  assert.equal(factory(torch).order, "torch");
  assert.equal(factory(torch).progress, clockRate(2));
  // Re-sending the current order keeps the work done.
  const same = send({
    seat: 0,
    type: "order",
    factory: TINY.robotFactory,
    kind: "grunt",
  });
  assert.equal(factory(same).progress, before.progress + clockRate(2));

  const hold = send({ seat: 1, type: "stance", stance: "hold" });
  assert.equal(hold.players[1]!.stance, "hold");
  assert.equal(hold.players[0]!.stance, "push");
  const bogus = {
    seat: 1,
    type: "stance",
    stance: "dance",
  } as unknown as Command;
  assert.equal(send(bogus).players[1]!.stance, "push");
  // Past the per-seat cap, a seat's commands drop.
  const flood: Command[] = Array.from({ length: COMMANDS_PER_SEAT }, () => ({
    seat: 0,
    type: "stance",
    stance: "follow",
  }));
  const last: Command = { seat: 0, type: "stance", stance: "hold" };
  assert.equal(send(...flood, last).players[0]!.stance, "follow");
});

test("capturing a factory restarts it on its default order", () => {
  const map = tiny();
  let world = step(
    map,
    place(createWorld(map, [0, 1], 1), 0, "grunt", map.flags[TINY.middle]!),
  );
  world = step(map, world, [
    { seat: 0, type: "order", factory: TINY.robotFactory, kind: "torch" },
  ]);
  world = run(map, world, 20);
  world = { ...world, units: [] };
  world = step(map, place(world, 1, "grunt", map.flags[TINY.middle]!));
  const factory = world.buildings.find((b) => b.id === TINY.robotFactory)!;
  assert.equal(world.sectors[TINY.middle], 1);
  assert.equal(factory.order, "grunt");
  // Seat 1 now holds its home and the middle.
  assert.equal(factory.progress, clockRate(2));
});

test("step leaves the world it is given untouched", () => {
  const map = dustBasin();
  let world = createWorld(map, [0, 1, 2, 3], 99);
  world = run(map, world, 600);
  const frozen = deepFreeze(structuredClone(world));
  const copy = structuredClone(frozen);
  const fort = map.sites.find((s) => s.kind === "fort" && s.seat === 0)!;
  const next = stepTick(map, frozen, [
    { seat: 0, type: "stance", stance: "hold" },
    { seat: 1, type: "order", factory: fort.id, kind: "grunt" },
  ]);
  assert.deepEqual(frozen, copy);
  assert.equal(next.step, frozen.step + 2);
  assert.notEqual(next.units, frozen.units);
});

test("the view reports owners, progress in thousandths and units by team", () => {
  const map = tiny();
  let world = step(
    map,
    place(createWorld(map, [0, 1], 1), 0, "grunt", map.flags[TINY.middle]!),
  );
  world = run(map, world, 99);
  const view = viewOf(map, world);
  assert.equal(view.flags[TINY.middle]!.owner, 0);
  assert.equal(view.flags[TINY.southEast]!.team, -1);
  const factory = view.buildings.find((b) => b.id === TINY.robotFactory)!;
  assert.equal(factory.owner, 0);
  assert.equal(
    factory.progress,
    Math.floor((100 * clockRate(2) * 1000) / (UNITS.grunt.build * 100)),
  );
  assert.equal(view.buildings.find((b) => b.id === TINY.fort1)!.owner, 1);
  assert.equal(view.units[0]!.team, 0);
});

test("imul matches Math.imul", () => {
  const values = [
    0, 1, -1, 0x7fffffff, -0x80000000, 0xdeadbeef, 0x01000193, 123456789,
  ];
  for (const a of values)
    for (const b of values)
      assert.equal(imul(a, b), Math.imul(a, b), `${a} × ${b}`);
});

test("seats' commands in one tick do not depend on the order they arrive in", () => {
  const map = tiny();
  let world = step(
    map,
    place(createWorld(map, [0, 1], 1), 0, "grunt", map.flags[TINY.middle]!),
  );
  world = run(map, world, 5);
  const commands: Command[] = [
    { seat: 0, type: "order", factory: TINY.robotFactory, kind: "torch" },
    { seat: 1, type: "stance", stance: "hold" },
    { seat: 0, type: "stance", stance: "follow" },
    { seat: 1, type: "order", factory: TINY.robotFactory, kind: "grunt" },
  ];
  const forward = hashWorld(step(map, world, commands));
  assert.equal(hashWorld(step(map, world, [...commands].reverse())), forward);
  // Within one seat the order is the seat's own: the last stance wins.
  const flipped = step(map, world, [
    { seat: 0, type: "stance", stance: "hold" },
    { seat: 0, type: "stance", stance: "follow" },
  ]);
  assert.equal(flipped.players[0]!.stance, "follow");
});
