import test from "node:test";
import assert from "node:assert/strict";
import {
  DROP_HP,
  HERO_XP,
  decodeWorld,
  encodeWorld,
  hashWorld,
  KILL_XP,
  KITS,
  MINES_PER_HERO,
  MINE_FUSE,
  centreOf,
  step,
  tickMines,
  unitCap,
  type World,
} from "../src/engine/index.js";
import { addUnit, arena, fire } from "./fixtures/heroes.js";
import { tiny } from "./fixtures/maps.js";

const map = tiny();
const [SNIPE, CLOAK, MINE] = KITS.vix as [
  (typeof KITS.vix)[0],
  (typeof KITS.vix)[0],
  (typeof KITS.vix)[0],
];

test("SNIPE hits the enemy nearest the aim: a robot for its damage, a vehicle for three times it", () => {
  const world = arena("vix");
  const grunt = addUnit(world, 1, "grunt", 8, 6);
  const tank = addUnit(world, 1, "lightTank", 10, 6);
  addUnit(world, 0, "grunt", 9, 6); // a friend is never a target
  const [, robot] = fire(world, 0, 8, 6);
  assert.equal(
    robot.units.find((u) => u.id === grunt.id)!.hp,
    1000 - SNIPE.damage,
  );
  const [, vehicle] = fire(world, 0, 10, 6);
  assert.equal(
    vehicle.units.find((u) => u.id === tank.id)!.hp,
    1000 - 3 * SNIPE.damage,
  );
  assert.equal(vehicle.heroes[0]!.spells[0], SNIPE.cooldown);
});

test("SNIPE kills for XP, and is refused with nothing in reach of the aim or the hero", () => {
  const world = arena("vix");
  addUnit(world, 1, "lightTank", 7, 6, 100);
  const [cast, killed] = fire(world, 0, 7, 6);
  assert.ok(cast);
  assert.equal(killed.units.length, 0);
  assert.equal(killed.heroes[0]!.xp, world.heroes[0]!.xp + KILL_XP.lightTank);
  assert.deepEqual(
    fire(world, 0, 12, 2)[0],
    false,
    "nothing within its radius of the aim",
  );
  const far = arena("vix");
  Object.assign(far.heroes[0]!, { x: centreOf(1), y: centreOf(8) });
  addUnit(far, 1, "grunt", 13, 1);
  const [refused, same] = fire(far, 0, 13, 1);
  assert.equal(refused, false, "beyond its range of the hero");
  assert.equal(same.heroes[0]!.energy, far.heroes[0]!.energy);
});

test("SNIPE fells a wounded hero but never picks a cloaked one", () => {
  const world = arena("vix", 1, "vix");
  Object.assign(world.heroes[1]!, {
    hp: 50,
    respawn: 0,
    x: centreOf(8),
    y: centreOf(6),
  });
  const [, felled] = fire(world, 0, 8, 6);
  assert.equal(felled.heroes[1]!.hp, 0);
  assert.ok(felled.heroes[1]!.respawn > 0);
  assert.ok(
    felled.events.some((e) => e.type === "heroDeath" && e.killer === 0),
  );
  assert.ok(felled.heroes[0]!.xp >= HERO_XP);
  world.heroes[1]!.cloak = 10;
  assert.equal(fire(world, 0, 8, 6)[0], false);
});

/** Steps until `left` steps have run or `stop` holds; returns the world. */
function run(world: World, left: number, stop = (_: World) => false): World {
  for (; left > 0 && !stop(world); left--) world = step(map, world);
  return world;
}

test("CLOAK hides Vix from every gun for its duration, then the enemy fires again", () => {
  let world = arena("vix");
  addUnit(world, 1, "grunt", 6, 6);
  [, world] = fire(world, 1);
  assert.equal(world.heroes[0]!.cloak, CLOAK.duration);
  const shotAt = (w: World) =>
    w.events.some(
      (e) => e.type === "shot" && e.to.of === "hero" && e.to.id === 0,
    );
  let hidden = world;
  for (let index = 1; index < CLOAK.duration; index++) {
    hidden = step(map, hidden);
    assert.ok(!shotAt(hidden), `step ${index}`);
  }
  hidden = run(hidden, 40, shotAt);
  assert.equal(hidden.heroes[0]!.cloak, 0);
  assert.ok(shotAt(hidden), "fired on once the cloak is gone");
});

test("a flag taken by a cloaked hero raises no capture alert", () => {
  const onFlag = (cloak: number) => {
    const world = arena("vix");
    Object.assign(world.heroes[0]!, { x: centreOf(6), y: centreOf(5), cloak });
    return step(map, world);
  };
  const [loud, quiet] = [onFlag(0), onFlag(20)];
  assert.equal(loud.sectors[2], 0);
  assert.equal(quiet.sectors[2], 0);
  assert.ok(loud.events.some((e) => e.type === "capture" && e.sector === 2));
  assert.ok(!quiet.events.some((e) => e.type === "capture"));
});

test("STICKY MINE lies on the aim in range (else at Vix), sticks to the first enemy tank and blows up a fuse later", () => {
  const world = arena("vix");
  const [, laid] = fire(world, 2, 6, 6);
  assert.deepEqual(laid.mines, [
    {
      owner: 0,
      x: centreOf(6),
      y: centreOf(6),
      life: MINE.duration,
      stuck: -1,
    },
  ]);
  assert.equal(
    fire(world, 2, 12, 6)[1].mines[0]!.x,
    centreOf(4),
    "out of range: at Vix",
  );
  addUnit(laid, 0, "lightTank", 6, 6); // a friend never sets it off
  addUnit(laid, 1, "grunt", 6, 6); // nor a robot
  const tank = addUnit(laid, 1, "lightTank", 6, 7);
  tickMines(laid);
  assert.equal(laid.mines[0]!.stuck, tank.id);
  for (let index = 1; index < MINE_FUSE; index++) tickMines(laid);
  assert.equal(laid.units.find((u) => u.id === tank.id)!.hp, 1000);
  tickMines(laid);
  assert.equal(
    laid.units.find((u) => u.id === tank.id)!.hp,
    1000 - MINE.damage,
  );
  assert.deepEqual(laid.mines, []);
  assert.ok(laid.events.some((e) => e.type === "mine"));
});

test("an unused mine runs out, and a fourth replaces the oldest", () => {
  let world = arena("vix");
  for (let n = 0; n <= MINES_PER_HERO; n++) {
    world.heroes[0]!.spells[2] = 0;
    [, world] = fire(world, 2, 3 + n, 6);
  }
  assert.deepEqual(
    world.mines.map((mine) => mine.x),
    [4, 5, 6].map(centreOf),
  );
  world.mines = [
    { owner: 0, x: centreOf(4), y: centreOf(6), life: 1, stuck: -1 },
  ];
  tickMines(world);
  assert.deepEqual(world.mines, []);
});

test("HIJACK turns an enemy tank to Vix's side at level 6, never at the cap, below the level or on a robot", () => {
  const world = arena("vix", 6);
  addUnit(world, 1, "grunt", 7, 6);
  const tank = addUnit(world, 1, "lightTank", 8, 6);
  const [cast, taken] = fire(world, 3, 8, 6);
  assert.ok(cast);
  const turned = taken.units.find((u) => u.id === tank.id)!;
  assert.deepEqual([turned.owner, turned.goal], [0, -1]);
  assert.equal(
    fire(world, 3, 7, 6)[1].units[0]!.owner,
    1,
    "the tank, not the nearer robot",
  );
  assert.equal(fire(arena("vix", 5), 3, 8, 6)[0], false);
  const full = structuredClone(world);
  while (full.units.filter((u) => u.owner === 0).length < unitCap(full, 0))
    addUnit(full, 0, "grunt", 2, 4);
  assert.equal(fire(full, 3, 8, 6)[0], false);
});

test("every world a mine fight steps through decodes to itself, and no step touches the world before it", () => {
  let [, world] = fire(arena("vix"), 2, 6, 6);
  // Within what a checkpoint allows: a level 1 hero's energy and respawn, a drop tank's hit points.
  Object.assign(world.heroes[0]!, { energy: 100 });
  Object.assign(world.heroes[1]!, { respawn: 300 });
  addUnit(world, 1, "lightTank", 7, 6, DROP_HP);
  let stuck = false;
  for (let index = 0; index < 120; index++) {
    const before = JSON.stringify(encodeWorld(world));
    const next = step(map, world);
    assert.equal(JSON.stringify(encodeWorld(world)), before);
    world = next;
    stuck ||= world.mines.some((mine) => mine.stuck >= 0);
    const wire = JSON.parse(JSON.stringify(encodeWorld(world)));
    assert.equal(hashWorld(decodeWorld(wire, map)!), hashWorld(world));
  }
  assert.ok(stuck, "the tank picked the mine up");
});
