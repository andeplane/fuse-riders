import test from "node:test";
import assert from "node:assert/strict";
import {
  DROP_HP,
  HERO,
  KILL_XP,
  KITS,
  RALLY_PERCENT,
  UNITS,
  centreOf,
  createWorld,
  decodeWorld,
  div,
  encodeWorld,
  isqrt,
  levelXp,
  unitCap,
  loadMap,
  step,
  tileOf,
  type Command,
  type Hero,
  type UnitKind,
  type World,
} from "../src/engine/index.js";
import { tiny, tinyFile } from "./fixtures/maps.js";

const map = tiny();
const at = centreOf;
const [Q, W, E, R] = KITS.brick;

const withHero = (world: World, seat: number, patch: Partial<Hero>): World => ({
  ...world,
  heroes: world.heroes.map((h) => (h.seat === seat ? { ...h, ...patch } : h)),
});
function add(
  world: World,
  owner: number,
  kind: UnitKind,
  tx: number,
  ty: number,
  hp = 1000,
): World {
  const unit = { id: world.nextId, kind, owner, x: at(tx), y: at(ty) };
  const rest = { hp, cooldown: 0, goal: -1, stun: 0, rally: 0 };
  return {
    ...world,
    units: [...world.units, { ...unit, ...rest }],
    nextId: world.nextId + 1,
  };
}
const cast = (seat: number, slot: number, x = 0, y = 0): Command => ({
  seat,
  type: "cast",
  slot,
  x,
  y,
});
/** Brick of seat 0 in the open middle of the tiny map, facing east, at `level`. */
const brick = (level = 1): World =>
  withHero(createWorld(map, [0, 1], 1), 0, {
    x: at(4),
    y: at(6),
    xp: levelXp(level),
    energy: 200,
  });
const hero0 = (world: World): Hero => world.heroes[0]!;

test("a cast spends energy, starts the cooldown and is ready again exactly a cooldown later", () => {
  let world = step(map, brick(), [cast(0, 0)]);
  assert.equal(hero0(world).energy, 200 - Q!.energy);
  assert.equal(hero0(world).spells[0], Q!.cooldown);
  assert.deepEqual(
    world.events.find((e) => e.type === "cast"),
    // prettier-ignore
    { type: "cast", seat: 0, slot: 0, effect: "shockwave", x: at(4), y: at(6), toX: at(4), toY: at(6) },
  );
  for (let index = 1; index < Q!.cooldown; index++)
    world = step(map, world, [cast(0, 0)]);
  assert.equal(
    hero0(world).energy,
    200 - Q!.energy,
    "every early cast refused",
  );
  world = step(map, world, [cast(0, 0)]);
  assert.equal(hero0(world).energy, 200 - 2 * Q!.energy);
});

test("a cast that cannot be made does nothing", () => {
  const plain = encodeWorld(step(map, brick()));
  const refused: [World, Command][] = [
    [brick(), cast(0, 2)], // the passive
    [brick(5), cast(0, 3)], // the ultimate below level 6
    [withHero(brick(), 0, { energy: Q!.energy - 1 }), cast(0, 0)],
    [withHero(brick(), 0, { spells: [5, 0, 0, 0] }), cast(0, 0)],
    [withHero(brick(), 0, { hp: 0, respawn: 50 }), cast(0, 0)],
    [brick(), cast(0, 4)],
    [brick(), cast(0, 0.5)],
    [brick(), cast(0, 0, 14, 0)], // aimed off the map
    [brick(), cast(0, 0, -1, 0)],
  ];
  for (const [world, command] of refused) {
    const next = step(map, world, [command]);
    assert.ok(
      !next.events.some((e) => e.type === "cast"),
      JSON.stringify(command),
    );
    if (world.heroes[0]!.hp > 0 && world.heroes[0]!.spells[0] === 0)
      assert.equal(next.heroes[0]!.energy, world.heroes[0]!.energy);
  }
  assert.deepEqual(encodeWorld(step(map, brick(), [cast(0, 2)])), plain);
});

test("SHOCKWAVE hurts enemy units near Brick and stuns and knocks back its robots, not tanks or friends", () => {
  let world = brick();
  world = add(world, 1, "grunt", 6, 6); // 1: two tiles east
  world = add(world, 1, "lightTank", 4, 8); // 2
  world = add(world, 0, "grunt", 3, 6); // 3
  world = add(world, 1, "grunt", 9, 6); // 4: out of reach
  world = step(map, world, [cast(0, 0)]);
  const [grunt, tank, friend, far] = world.units;
  assert.equal(grunt!.stun, Q!.duration);
  assert.equal(grunt!.x, at(6) + Q!.power, "pushed a tile east");
  assert.deepEqual([tank!.stun, friend!.stun, far!.stun], [0, 0, 0]);
  // Guns fire after the cast in the same step, so the hurt ones may have lost more.
  assert.ok(grunt!.hp <= 1000 - Q!.damage && tank!.hp <= 1000 - Q!.damage);
  assert.deepEqual([friend!.hp, far!.hp], [1000, 1000]);
  // While stunned it neither shoots nor walks; then it fights again.
  for (let index = 1; index < Q!.duration; index++) {
    const before = world.units[0]!;
    world = step(map, world);
    assert.ok(!world.events.some((e) => e.type === "shot" && e.from.id === 1));
    assert.equal(world.units[0]!.stun, before.stun - 1);
  }
  world = step(map, world);
  assert.equal(world.units[0]!.stun, 0);
  assert.ok(world.events.some((e) => e.type === "shot" && e.from.id === 1));
});

test("RALLY CRY makes friendly robots in reach reload faster while it lasts", () => {
  let world = brick(3);
  world = add(world, 0, "grunt", 6, 8); // 1: rallied
  world = add(world, 1, "grunt", 9, 8); // 2: an enemy in its range
  world = add(world, 0, "lightTank", 5, 8); // 3: no robot
  world = step(map, world, [cast(0, 1)]);
  const duration = W!.duration + 2 * W!.durationPerLevel;
  assert.equal(world.units[0]!.rally, duration);
  assert.equal(world.units[1]!.rally, 0);
  assert.equal(world.units[2]!.rally, 0);
  const fast = div(UNITS.grunt.cooldown * 100, 100 + RALLY_PERCENT);
  assert.equal(world.units[0]!.cooldown, fast);
  world = step(map, world);
  assert.equal(world.units[0]!.rally, duration - 1);
});

test("RALLY CRY also speeds a rallied robot's walk", () => {
  const walk = (rally: number): number => {
    const world = add(brick(), 0, "grunt", 5, 8, 60);
    world.units[0]!.rally = rally;
    const moved = step(map, world).units[0]!;
    return isqrt((moved.x - at(5)) ** 2 + (moved.y - at(8)) ** 2);
  };
  assert.ok(walk(0) > 0);
  assert.ok(walk(10) > walk(0) + 2, `${walk(10)} vs ${walk(0)}`);
});

test("SHOCKWAVE kills what it outdamages at once, credited to Brick", () => {
  const world = step(map, add(brick(), 1, "grunt", 5, 6, 60), [cast(0, 0)]);
  assert.deepEqual(world.units, []);
  assert.ok(world.events.some((e) => e.type === "death" && e.id === 1));
  assert.equal(hero0(world).xp, KILL_XP.grunt);
});

test("IRON HIDE spares Brick and friendly vehicles near Brick, not robots or far tanks", () => {
  const hit = (world: World, id: number): number =>
    step(map, world).events.flatMap((e) =>
      e.type === "shot" && e.to.of === "unit" && e.to.id === id
        ? [e.damage]
        : [],
    )[0]!;
  let world = withHero(brick(), 1, { x: at(12), y: at(8) });
  world = add(world, 0, "lightTank", 4, 8); // 1: near Brick
  world = add(world, 1, "lightTank", 8, 8); // 2: shoots 1
  const hide = 100 - E!.power;
  assert.equal(hit(world, 1), div(UNITS.lightTank.damage * hide, 100));
  const far = withHero(world, 0, { x: at(1), y: at(1) });
  assert.equal(hit(far, 1), UNITS.lightTank.damage);
  const level5 = withHero(world, 0, { xp: levelXp(5) });
  assert.equal(
    hit(level5, 1),
    div(UNITS.lightTank.damage * (hide - 4 * E!.powerPerLevel), 100),
  );
});

test("ORBITAL DROP lands a light tank beside Brick from level 6, inside the unit cap", () => {
  let world = step(map, brick(6), [cast(0, 3)]);
  const tank = world.units.at(-1)!;
  assert.deepEqual(
    [tank.kind, tank.owner, tileOf(tank.x), tileOf(tank.y)],
    ["lightTank", 0, 5, 6],
  );
  assert.equal(tank.hp, DROP_HP, "tougher than a factory's");
  assert.ok(DROP_HP > UNITS.lightTank.hp);
  assert.equal(hero0(world).spells[3], R!.cooldown);
  // At the cap nothing lands and nothing is spent.
  world = brick(6);
  const cap = unitCap(world, 0);
  for (let index = 0; index < cap; index++)
    world = add(world, 0, "grunt", 1 + (index % 4), 2 + (index % 3));
  const capped = step(map, world, [cast(0, 3)]);
  assert.equal(hero0(capped).spells[3], 0);
  assert.ok(capped.units.filter((u) => u.owner === 0).length <= cap);
});

test("ORBITAL DROP never lands across a rock's corner or on rock", () => {
  const file = tinyFile();
  // Brick at (4, 6): rock at (5, 6) east and at (4, 7) south, so the south-east tile (5, 7) is only a corner away.
  file.terrain[6] = "#....#.......#";
  file.terrain[7] = "#...#........#";
  const pinched = loadMap(file);
  const drop = (facing: number): [number, number] => {
    const world = withHero(brick(6), 0, { facing });
    const next = step(pinched, world, [cast(0, 3)]);
    const tank = next.units.at(-1)!;
    assert.equal(tank.kind, "lightTank");
    return [tileOf(tank.x), tileOf(tank.y)];
  };
  assert.deepEqual(
    drop(4),
    [4, 6],
    "the corner tile is refused, so Brick's own",
  );
  assert.deepEqual(drop(0), [4, 6], "rock to the east, so Brick's own");
  assert.deepEqual(drop(3), [4, 5], "open ground to the north is used");
});

test("statuses and spell cooldowns survive a checkpoint, and bad ones are refused", () => {
  // A torch lives through the shockwave's damage, so it stays stunned (Brick's gun is reloading).
  let world = withHero(brick(), 0, { cooldown: HERO.cooldown });
  world = add(world, 1, "torch", 6, 6, 90);
  world = add(world, 0, "grunt", 3, 6, 60);
  world = step(map, world, [cast(0, 0), cast(0, 1)]);
  const wire = () => structuredClone(encodeWorld(world)) as unknown[][][];
  assert.deepEqual(decodeWorld(wire(), map), { ...world, events: [] });
  const bad: [string, (w: unknown[][][]) => void][] = [
    ["a stun past its longest", (w) => (w[6]![0]![8] = 999)],
    ["a rally past its longest", (w) => (w[6]![1]![9] = 999)],
    ["a negative stun", (w) => (w[6]![0]![8] = -1)],
    [
      "a cooldown past its slot's",
      (w) => ((w[7]![0]![12] as number[])[0] = 9999),
    ],
    ["a passive cooling down", (w) => ((w[7]![0]![12] as number[])[2] = 1)],
    ["a missing slot", (w) => (w[7]![0]![12] as number[]).pop()],
  ];
  for (const [label, corrupt] of bad) {
    const w = wire();
    corrupt(w);
    assert.equal(decodeWorld(w, map), undefined, label);
  }
  const tank = add(brick(), 0, "lightTank", 5, 5);
  const stunned = encodeWorld(tank) as unknown[][][];
  stunned[6]![0]![8] = 1;
  assert.equal(decodeWorld(stunned, map), undefined, "a stunned tank");
});
