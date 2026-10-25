import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMP_GUARDS,
  CAMP_RESPAWN,
  GRUNT_ARMOUR,
  NEUTRAL,
  STEPS_PER_SECOND,
  TILE,
  UNITS,
  WAVE_EVERY,
  WAVE_FIRST,
  campOf,
  centreOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  nearestLane,
  spawnWaves,
  step,
  tileOf,
  upgrades,
  type World,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import { addUnit, benchHeroes } from "./fixtures/heroes.js";

const twin = mapById("twin-wilds");
const guards = (world: World) => world.units.filter((u) => u.owner === NEUTRAL);
const run = (world: World, steps: number) => {
  for (let index = 0; index < steps; index++) world = step(twin, world);
  return world;
};
/** A 1v1 on Twin Wilds with both heroes waiting to respawn, so only what a test adds fights. */
const quiet = () => benchHeroes(createWorld(twin, [0, 1], 1));
/** Jungle sector 4's flag, camp and factory (the first jungle sector in the file). */
const SECTOR = 4;
const camp = twin.camps[campOf(twin, SECTOR)]!;
const flag = twin.flags[SECTOR]!;

test("every camp's neutral guards stand on its tile from the first step, and never walk or burn out", () => {
  let world = run(quiet(), 1);
  assert.equal(guards(world).length, CAMP_GUARDS * twin.camps.length);
  for (const [index, spot] of twin.camps.entries()) {
    const here = guards(world).filter(
      (u) => tileOf(u.x) === spot.x && tileOf(u.y) === spot.y,
    );
    assert.equal(here.length, CAMP_GUARDS, `camp ${index}`);
    assert.ok(here.every((u) => u.kind === "sentry" && u.lane === -1));
  }
  const before = guards(world).map((u) => [u.x, u.y, u.hp]);
  world = run(world, 60 * STEPS_PER_SECOND);
  assert.deepEqual(
    guards(world).map((u) => [u.x, u.y, u.hp]),
    before,
  );
  assert.ok(world.camps.every((left) => left === CAMP_RESPAWN));
});

test("a cleared camp stands again after its respawn time, and not a step sooner", () => {
  let world = run(quiet(), 1);
  const index = campOf(twin, SECTOR);
  world.units = world.units.filter(
    (u) =>
      !(
        u.owner === NEUTRAL &&
        tileOf(u.x) === camp.x &&
        tileOf(u.y) === camp.y
      ),
  );
  world = run(world, CAMP_RESPAWN - 1);
  assert.equal(guards(world).length, CAMP_GUARDS * (twin.camps.length - 1));
  assert.equal(world.camps[index], 1);
  world = run(world, 1);
  assert.equal(guards(world).length, CAMP_GUARDS * twin.camps.length);
});

test("guards shoot a hero but leave the waves alone, and the waves leave them", () => {
  let world = run(quiet(), 1);
  const wave = addUnit(world, 0, "grunt", camp.x + 2, camp.y, 5000);
  Object.assign(wave, { lane: 0, wave: 1 });
  let shots = 0;
  for (let index = 0; index < 2 * STEPS_PER_SECOND; index++) {
    world = step(twin, world);
    world.units.find((u) => u.id === wave.id)!.x = centreOf(camp.x + 2);
    shots += world.events.filter((e) => e.type === "shot").length;
  }
  assert.equal(shots, 0);
  Object.assign(world.heroes[0]!, {
    hp: 900,
    respawn: 0,
    x: centreOf(flag.x),
    y: centreOf(flag.y),
  });
  world = step(twin, world);
  const at = world.events.flatMap((e) =>
    e.type === "shot" && e.from.of === "unit" ? [e.to.of] : [],
  );
  assert.ok(at.length > 0 && at.every((of) => of === "hero"));
});

test("a guarded jungle flag can't be taken, a cleared one can, and a home flag never", () => {
  let world = run(quiet(), 1);
  const hero = world.heroes[0]!;
  Object.assign(hero, {
    hp: 50_000,
    respawn: 0,
    x: centreOf(flag.x),
    y: centreOf(flag.y),
  });
  world = step(twin, world);
  assert.equal(world.sectors[SECTOR], NEUTRAL, "guarded");
  world.units = world.units.filter((u) => u.owner !== NEUTRAL);
  world = step(twin, world);
  assert.equal(world.sectors[SECTOR], 0, "cleared and taken");
  const home = twin.flags[1]!;
  Object.assign(world.heroes[0]!, { x: centreOf(home.x), y: centreOf(home.y) });
  world = step(twin, world);
  assert.equal(world.sectors[1], 1, "the enemy's home flag holds");
});

test("a held robot factory adds a torch to its nearest lane and armours the grunts; a vehicle factory a tank every third wave", () => {
  const robot = twin.sites.find((s) => s.kind === "robotFactory")!;
  const vehicle = twin.sites.find((s) => s.kind === "vehicleFactory");
  const world = { ...quiet(), step: WAVE_FIRST + 2 * WAVE_EVERY };
  world.sectors[robot.sector] = 0;
  if (vehicle) world.sectors[vehicle.sector] = 0;
  const ups = upgrades(twin, world, 0);
  assert.equal(ups.armour, true);
  assert.equal(upgrades(twin, world, 1).armour, false);
  spawnWaves(twin, world);
  const kinds = (team: number, lane: number) =>
    world.units
      .filter((u) => u.owner % 2 === team && u.lane === lane)
      .map((u) => u.kind)
      .sort();
  const lane = nearestLane(twin, robot.id);
  const torches = kinds(0, lane).filter((k) => k === "torch").length;
  assert.ok(torches >= 2, "an extra torch");
  assert.equal(kinds(1, lane).filter((k) => k === "torch").length, 1);
  if (vehicle) {
    // Wave 3: the vehicle factory's lane gets its tank.
    assert.ok(kinds(0, nearestLane(twin, vehicle.id)).includes("lightTank"));
    const next = {
      ...world,
      step: WAVE_FIRST + 3 * WAVE_EVERY,
      units: [] as World["units"],
    };
    spawnWaves(twin, next);
    assert.ok(
      next.units.every((u) => u.kind !== "lightTank"),
      "not wave 4",
    );
  }
  // Losing the sector loses it.
  world.sectors[robot.sector] = 1;
  assert.equal(upgrades(twin, world, 0).torches[lane], 0);
});

test("armoured wave grunts take a quarter less from a tower", () => {
  const shot = (armoured: boolean) => {
    let world = run(quiet(), 1);
    const robot = twin.sites.find((s) => s.kind === "robotFactory")!;
    if (armoured) world.sectors[robot.sector] = 0;
    const tower = twin.sites.find((s) => s.team === 1 && s.tier === 0)!;
    const grunt = addUnit(world, 0, "grunt", tower.x - 3, tower.y, 5000);
    Object.assign(grunt, { lane: 0, wave: 1 });
    for (let index = 0; index < 3 * STEPS_PER_SECOND; index++) {
      world = step(twin, world);
      const hit = world.events.find(
        (e) =>
          e.type === "shot" && e.from.id === tower.id && e.to.id === grunt.id,
      );
      if (hit?.type === "shot") return hit.damage;
    }
    return -1;
  };
  const [plain, armoured] = [shot(false), shot(true)];
  assert.ok(plain > 0);
  assert.equal(armoured, Math.floor((plain * (100 - GRUNT_ARMOUR)) / 100));
});

test("a camp guard's kill pays the killer's team, not its enemy standing by", () => {
  let world = run(quiet(), 1);
  for (const guard of guards(world)) guard.hp = 1;
  const guard = guards(world)[0]!;
  // Seat 0 shoots the camp from 3 tiles; seat 1 stands within an assist's reach but out of every gun's range.
  for (const [seat, dx] of [
    [0, -3],
    [1, 7],
  ] as const)
    Object.assign(world.heroes[seat]!, {
      hp: 50_000,
      respawn: 0,
      x: guard.x + dx * TILE,
      y: guard.y,
      xp: 0,
    });
  world = step(twin, world);
  assert.equal(guards(world).length, CAMP_GUARDS * (twin.camps.length - 1));
  assert.ok(world.heroes[0]!.xp > 0);
  assert.equal(world.heroes[1]!.xp, 0, "the other team gets no share");
});

const corruptions: [string, (units: number[][], wire: unknown[]) => void][] = [
  ["a guard off its camp", (u) => (u[0]![3] = centreOf(camp.x + 3))],
  ["a neutral grunt", (u) => (u[0]![1] = 0)],
  ["a neutral in a lane", (u) => ([u[0]![10], u[0]![11]] = [0, 1])],
  [
    "a camp with a guard too many",
    (u, wire) => {
      u.push([(wire[2] as number) + 0, ...u[0]!.slice(1)]);
      wire[2] = (wire[2] as number) + 1;
    },
  ],
  ["a camp timer at 0", (_, wire) => ((wire[12] as number[])[0] = 0)],
  [
    "a camp timer past the respawn",
    (_, wire) => ((wire[12] as number[])[0] = CAMP_RESPAWN + 1),
  ],
  ["a camp missing", (_, wire) => (wire[12] as number[]).pop()],
];

for (const [label, corrupt] of corruptions)
  test(`a checkpoint with ${label} is refused`, () => {
    const world = run(quiet(), 1);
    // Only the first camp's guards, so the unit ids stay in order when one is copied.
    world.units = world.units.filter(
      (u) => u.owner === NEUTRAL && tileOf(u.x) === twin.camps[0]!.x,
    );
    const wire = structuredClone(encodeWorld(world)) as unknown[];
    assert.ok(decodeWorld(structuredClone(wire), twin), "the base decodes");
    corrupt(wire[6] as number[][], wire);
    assert.equal(decodeWorld(wire, twin), undefined);
  });

test("guards are UNITS.sentry at full health", () => {
  const world = run(quiet(), 1);
  assert.ok(guards(world).every((u) => u.hp === UNITS.sentry.hp));
});
