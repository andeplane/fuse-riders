import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILDING_HP,
  createWorld,
  decodeWorld,
  encodeWorld,
  fell,
  hashWorld,
  FLARE,
  KITS,
  SENTRY_DECAY,
  UNITS,
  centreOf,
  clockRate,
  hideOf,
  isqrt,
  productionRate,
  step,
  teamSectors,
  tileOf,
  unitCap,
  type World,
} from "../src/engine/index.js";
import { addUnit, arena, fire } from "./fixtures/heroes.js";
import { TINY, tiny } from "./fixtures/maps.js";

const map = tiny();
const [REPAIR, , FORTIFY, OVERCLOCK] = KITS.rivet as [
  (typeof KITS.rivet)[0],
  unknown,
  (typeof KITS.rivet)[0],
  (typeof KITS.rivet)[0],
];
const [, FLARE_SPELL] = KITS.tally;

test("REPAIR BEAM heals the hurt friend nearest the aim up to its most, and Rivet too", () => {
  const world = arena("rivet");
  const grunt = addUnit(world, 0, "grunt", 5, 6, 30);
  const tank = addUnit(world, 0, "lightTank", 6, 6, 50);
  addUnit(world, 1, "grunt", 6, 7, 10); // an enemy is never healed
  const healed = (tx: number, ty: number, id: number) =>
    fire(world, 0, tx, ty)[1].units.find((u) => u.id === id)!.hp;
  assert.equal(healed(5, 6, grunt.id), UNITS.grunt.hp);
  assert.equal(healed(6, 6, tank.id), 50 + REPAIR!.power);
  world.heroes[0]!.hp = 100;
  assert.equal(fire(world, 0)[1].heroes[0]!.hp, 100 + REPAIR!.power);
  assert.equal(fire(arena("rivet"), 0)[0], false, "nothing hurt");
});

test("REPAIR BEAM stands a ruined turret in a held sector up again, never a ruined fort", () => {
  const world = arena("rivet");
  const turret = world.buildings.find((b) => b.id === TINY.turret)!;
  turret.hp = 0;
  assert.equal(fire(world, 0, 6, 6)[0], false, "a neutral sector's turret");
  world.sectors[map.sites[TINY.turret]!.sector] = 0;
  const [, rebuilt] = fire(world, 0, 6, 6);
  assert.equal(
    rebuilt.buildings.find((b) => b.id === TINY.turret)!.hp,
    REPAIR!.power,
  );
  const fort = arena("rivet");
  fort.buildings.find((b) => b.id === TINY.fort0)!.hp = 0;
  assert.equal(fire(fort, 0, 1, 1)[0], false);
  fort.buildings.find((b) => b.id === TINY.fort0)!.hp = 10;
  assert.equal(
    fire(fort, 0, 1, 1)[1].buildings.find((b) => b.id === TINY.fort0)!.hp,
    10 + REPAIR!.power,
  );
  assert.ok(BUILDING_HP.fort > 10 + REPAIR!.power);
});

test("TURRET DROP lands a sentry on the faced tile that stands still and burns out; two at most, none at the cap", () => {
  let world = arena("rivet");
  [, world] = fire(world, 1);
  const sentry = world.units[0]!;
  assert.deepEqual(
    [sentry.kind, sentry.x, sentry.y],
    ["sentry", centreOf(5), centreOf(6)],
  );
  world.heroes[0]!.spells[1] = 0;
  [, world] = fire(world, 1);
  world.heroes[0]!.spells[1] = 0;
  assert.equal(fire(world, 1)[0], false, "a third");
  let later = world;
  for (let index = 0; index < 20; index++) later = step(map, later);
  assert.deepEqual(
    [later.units[0]!.x, later.units[0]!.y],
    [sentry.x, sentry.y],
  );
  assert.equal(later.units[0]!.hp, UNITS.sentry.hp - 20 / SENTRY_DECAY);
  const full = arena("rivet");
  while (full.units.length < unitCap(full, 0)) addUnit(full, 0, "grunt", 2, 4);
  assert.equal(fire(full, 1)[0], false);
});

test("FORTIFY FLAG keeps the team's flag Rivet stands by from changing hands while it lasts", () => {
  let world = arena("rivet");
  Object.assign(world.heroes[0]!, { x: centreOf(2), y: centreOf(3) });
  [, world] = fire(world, 2);
  assert.equal(world.fortified[0], FORTIFY!.duration);
  addUnit(world, 1, "grunt", 2, 2, 5000);
  world = step(map, world);
  assert.equal(world.sectors[0], 0, "held while fortified");
  world.fortified[0] = 1;
  world = step(map, world);
  assert.equal(world.sectors[0], 1, "taken once it ends");
  assert.equal(
    fire(arena("rivet"), 2)[0],
    false,
    "not by a flag its team holds",
  );
});

test("OVERCLOCK doubles the team's production clock for exactly its duration", () => {
  let [, world] = fire(arena("rivet", 6), 3);
  const base = clockRate(teamSectors(world, 0));
  assert.equal(productionRate(world, 0), 2 * base);
  assert.equal(productionRate(world, 1), clockRate(teamSectors(world, 1)));
  for (let index = 1; index < OVERCLOCK!.duration; index++)
    world = step(map, world);
  assert.equal(productionRate(world, 0), 2 * base);
  world = step(map, world);
  assert.equal(productionRate(world, 0), base);
  assert.equal(fire(arena("rivet", 5), 3)[0], false);
});

test("DASH bounds to an aim within four tiles, along its facing when aimed at itself, and stops at a wall", () => {
  const dash = (tx: number, ty: number, from = 4) => {
    const world = arena("tally");
    world.heroes[0]!.x = centreOf(from);
    return fire(world, 0, tx, ty)[1].heroes[0]!;
  };
  assert.equal(dash(7, 6).x, centreOf(7));
  assert.equal(dash(8, 6).x, centreOf(8));
  assert.equal(fire(arena("tally"), 0, 12, 6)[0], false, "out of reach");
  assert.equal(dash(4, 6).x, centreOf(8), "east, its facing");
  assert.equal(tileOf(dash(0, 6, 2).x), 1, "the wall");
});

test("FLARE draws the owner's pushing robots to its tile until it goes out", () => {
  let world = arena("tally");
  const grunt = addUnit(world, 0, "grunt", 3, 6);
  const tile = 6 * map.width + 10;
  assert.equal(fire(world, 1, 13, 6)[0], false, "a wall");
  [, world] = fire(world, 1, 10, 6);
  assert.deepEqual(
    [world.heroes[0]!.flare, world.heroes[0]!.flareLeft],
    [tile, FLARE_SPELL!.duration],
  );
  assert.equal(world.units[0]!.goal, FLARE);
  for (let index = 0; index < 40; index++) world = step(map, world);
  assert.ok(
    world.units[0]!.x > grunt.x + 30 * UNITS.grunt.speed,
    "walked east to it",
  );
  world.heroes[0]!.flareLeft = 1;
  world = step(map, world);
  assert.deepEqual(
    [world.heroes[0]!.flare, world.units[0]!.goal !== FLARE],
    [-1, true],
  );
  const hold = arena("tally");
  addUnit(hold, 0, "grunt", 3, 6);
  hold.players[0]!.stance = "hold";
  assert.equal(fire(hold, 1, 10, 6)[1].units[0]!.goal, -1);
});

test("SPOTTER makes enemies near Tally take ten percent more, on top of Iron Hide", () => {
  const world = arena("tally");
  const near = addUnit(world, 1, "lightTank", 6, 6);
  const far = addUnit(world, 1, "lightTank", 12, 6);
  assert.equal(hideOf(world, near, 1), 110);
  assert.equal(hideOf(world, far, 1), 100);
  assert.equal(hideOf(world, world.heroes[0]!, 0), 100, "never its own side");
});

test("BLITZ quickens the owner's robots in Tally's sector by half, and no others", () => {
  const walked = (blitz: number, tx: number, ty: number): number => {
    let world: World = arena("tally");
    world.heroes[0]!.blitz = blitz;
    const grunt = addUnit(world, 0, "grunt", tx, ty);
    world = step(map, world);
    const moved = world.units[0]!;
    const [dx, dy] = [moved.x - grunt.x, moved.y - grunt.y];
    return isqrt(dx * dx + dy * dy);
  };
  const sector = (tx: number, ty: number) => map.sectorOf[ty * map.width + tx];
  assert.equal(sector(4, 6), sector(5, 6));
  const [plain, quick] = [walked(0, 5, 6), walked(50, 5, 6)];
  // Whole sub-pixels on a diagonal: half again as far, give or take the rounding.
  assert.ok(plain >= UNITS.grunt.speed - 1 && plain <= UNITS.grunt.speed);
  assert.ok(Math.abs(2 * quick - 3 * plain) <= 3, `${quick} v ${plain}`);
  assert.notEqual(sector(4, 6), sector(10, 2));
  assert.equal(walked(50, 10, 2), walked(0, 10, 2));
});

test("a FLARE goes out with Tally, and every world Rivet and Tally step through decodes to itself", () => {
  const map2 = tiny();
  let world = createWorld(map2, [0, 1], 1, { 0: "tally", 1: "rivet" });
  Object.assign(world.heroes[0]!, {
    x: centreOf(4),
    y: centreOf(6),
    energy: 100,
  });
  Object.assign(world.heroes[1]!, { x: centreOf(9), y: centreOf(6), hp: 100 });
  addUnit(world, 0, "grunt", 3, 6, UNITS.grunt.hp);
  world = step(map2, world, [
    { seat: 0, type: "cast", slot: 1, x: 10, y: 6 },
    { seat: 1, type: "cast", slot: 1, x: 0, y: 0 },
    { seat: 1, type: "cast", slot: 0, x: 9, y: 6 },
  ]);
  assert.equal(world.units[0]!.goal, FLARE);
  assert.ok(world.units.some((u) => u.kind === "sentry"));
  for (let index = 0; index < 30; index++) {
    world = step(map2, world);
    const wire = JSON.parse(JSON.stringify(encodeWorld(world)));
    assert.equal(hashWorld(decodeWorld(wire, map2)!), hashWorld(world));
  }
  assert.deepEqual(
    [world.heroes[0]!.hp > 0, world.units[0]!.goal],
    [true, FLARE],
  );
  fell(world, world.heroes[0]!, 1);
  assert.deepEqual([world.heroes[0]!.flare, world.units[0]!.goal], [-1, -1]);
  assert.ok(decodeWorld(encodeWorld(world), map2));
});
