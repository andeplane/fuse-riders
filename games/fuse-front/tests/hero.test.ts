import test from "node:test";
import assert from "node:assert/strict";
import {
  AURA_DAMAGE,
  CAPTURE_XP,
  FLOW_CACHE_SIZE,
  ROAMING_FLOW_CACHE_SIZE,
  cachedFlowFields,
  clearFlowCache,
  flowField,
  FOLLOW_HERO,
  HERO,
  KILL_XP,
  KITS,
  UNITS,
  centreOf,
  createWorld,
  decodeWorld,
  div,
  encodeWorld,
  hashWorld,
  heroShot,
  levelOf,
  levelXp,
  maxHp,
  respawnSteps,
  step,
  stepTick,
  tileOf,
  type Command,
  type Hero,
  type UnitKind,
  type World,
} from "../src/engine/index.js";
import { TINY, dustBasin, tiny } from "./fixtures/maps.js";

const map = tiny();
const at = centreOf;
/** A grunt's shot on a level 1 Brick, under its IRON HIDE. */
const HIDDEN_GRUNT = div(
  UNITS.grunt.damage * (100 - KITS.brick[2]!.power),
  100,
);

const withHero = (world: World, seat: number, patch: Partial<Hero>): World => ({
  ...world,
  heroes: world.heroes.map((h) => (h.seat === seat ? { ...h, ...patch } : h)),
});
const heroOf = (world: World, seat: number): Hero =>
  world.heroes.find((h) => h.seat === seat)!;

function add(
  world: World,
  owner: number,
  kind: UnitKind,
  tx: number,
  ty: number,
  hp = UNITS[kind].hp,
): World {
  const unit = {
    id: world.nextId,
    kind,
    owner,
    x: at(tx),
    y: at(ty),
    hp,
    cooldown: 0,
    goal: -1,
    stun: 0,
    rally: 0,
  };
  return { ...world, units: [...world.units, unit], nextId: world.nextId + 1 };
}

function run(world: World, steps: number, commands: Command[] = []): World {
  let next = step(map, world, commands);
  for (let index = 1; index < steps; index++) next = step(map, next);
  return next;
}

test("each seat starts with a level 1 hero on its fort's tile", () => {
  const world = createWorld(map, [0, 1, 2], 1);
  assert.deepEqual(
    world.heroes.map((h) => [h.seat, tileOf(h.x), tileOf(h.y), h.hp]),
    [
      [0, 1, 1, HERO.hp],
      [1, 12, 1, HERO.hp],
      [2, 1, 8, HERO.hp],
    ],
  );
  assert.deepEqual(
    [0, levelXp(2) - 1, levelXp(2), levelXp(6), levelXp(10), 1e9].map(levelOf),
    [1, 1, 2, 6, 10, 10],
  );
});

test("move walks the hero to a tile's centre along the flow field and stops", () => {
  let world = createWorld(map, [0, 1], 1);
  world = run(world, 400, [{ seat: 0, type: "move", x: 6, y: 4 }]);
  const hero = heroOf(world, 0);
  assert.deepEqual([hero.x, hero.y, hero.goal], [at(6), at(4), -1]);
  // It came round the rock at (6, 3); its last steps were east.
  assert.equal(hero.facing, 0);
});

test("steer walks the held direction until released; the latest of move and steer wins", () => {
  let world = createWorld(map, [0, 1], 1);
  world = step(map, world, [{ seat: 0, type: "steer", dx: 8, dy: 0 }]);
  assert.equal(heroOf(world, 0).x, at(1) + HERO.speed);
  world = step(map, world, [{ seat: 0, type: "steer", dx: 4, dy: 0 }]);
  assert.equal(heroOf(world, 0).x, at(1) + HERO.speed + HERO.speed / 2);
  world = step(map, world, [{ seat: 0, type: "move", x: 1, y: 6 }]);
  assert.deepEqual([heroOf(world, 0).steerX, heroOf(world, 0).goal], [0, 85]);
  // Releasing the stick leaves the move alone; holding it again cancels it.
  world = step(map, world, [{ seat: 0, type: "steer", dx: 0, dy: 0 }]);
  assert.equal(heroOf(world, 0).goal, 85);
  world = step(map, world, [{ seat: 0, type: "steer", dx: 0, dy: -3 }]);
  assert.deepEqual([heroOf(world, 0).steerY, heroOf(world, 0).goal], [-3, -1]);
  // Steering into the wall slides nowhere and never leaves open ground.
  world = run(world, 100);
  assert.equal(tileOf(heroOf(world, 0).y), 1);
});

test("bad move and steer commands do nothing", () => {
  const world = createWorld(map, [0, 1], 1);
  const bad: Command[] = [
    { seat: 0, type: "move", x: 6, y: 3 }, // rock
    { seat: 0, type: "move", x: 14, y: 1 }, // off the map
    { seat: 0, type: "move", x: 1.5, y: 1 },
    { seat: 0, type: "steer", dx: 9, dy: 0 },
    { seat: 0, type: "steer", dx: Number.NaN, dy: 0 },
    { seat: 0, type: "steer", dx: "1" as unknown as number, dy: 0 },
  ];
  for (const command of bad)
    assert.deepEqual(
      encodeWorld(step(map, world, [command])),
      encodeWorld(step(map, world)),
      JSON.stringify(command),
    );
});

test("a hero shoots the nearest enemy while walking, and enemies shoot it", () => {
  let world = createWorld(map, [0, 1], 1);
  world = withHero(world, 0, { x: at(4), y: at(5), steerX: 8 });
  world = add(world, 1, "grunt", 7, 5);
  const next = step(map, world);
  const shots = next.events.filter((e) => e.type === "shot");
  assert.deepEqual(
    shots.map((e) => [e.from.of, e.from.id, e.to.of, e.to.id, e.damage]),
    [
      ["unit", 1, "hero", 0, HIDDEN_GRUNT],
      ["hero", 0, "unit", 1, heroShot(1).damage],
    ],
  );
  assert.equal(heroOf(next, 0).x, at(4) + HERO.speed, "it kept walking");
});

test("a kill earns the killer's hero XP, a nearby teammate's hero half, and a level brings hit points", () => {
  let world = createWorld(map, [0, 1, 2], 1);
  world = withHero(world, 0, { x: at(4), y: at(5), xp: levelXp(2) - 1 });
  world = withHero(world, 2, { x: at(3), y: at(6) });
  world = withHero(world, 1, { x: at(12), y: at(8) });
  world = add(world, 1, "grunt", 7, 5, 1);
  const next = step(map, world);
  assert.equal(heroOf(next, 0).xp, levelXp(2) - 1 + KILL_XP.grunt);
  assert.equal(heroOf(next, 2).xp, KILL_XP.grunt / 2);
  assert.equal(
    heroOf(next, 0).hp,
    maxHp(2) - HIDDEN_GRUNT,
    "a level, less the grunt's last shot",
  );
  assert.deepEqual(
    next.events.filter((e) => e.type === "levelUp"),
    [{ type: "levelUp", seat: 0, level: 2 }],
  );
});

test("two shots that both kill credit the owner of the first in shooter order, wherever the units are listed", () => {
  const killedBy = (first: number, second: number): [number, number] => {
    let world = createWorld(map, [0, 1, 2], 1);
    world = add(world, 1, "grunt", 11, 5, 1);
    world = add(world, first, "torch", 10, 5);
    world = add(world, second, "torch", 10, 6);
    const next = step(map, world);
    assert.equal(next.units.filter((u) => u.owner === 1).length, 0);
    return [heroOf(next, 0).xp, heroOf(next, 2).xp];
  };
  // The lower unit id is first in shooter order; its owner's hero earns the kill, the other (far away) nothing.
  assert.deepEqual(killedBy(0, 2), [KILL_XP.grunt, 0]);
  assert.deepEqual(killedBy(2, 0), [0, KILL_XP.grunt]);
});

test("a hero dies, waits its level's respawn and returns to its fort, its killer credited", () => {
  let world = createWorld(map, [0, 1], 1);
  world = withHero(world, 1, { x: at(8), y: at(5), hp: 1, xp: levelXp(3) });
  world = add(world, 0, "grunt", 6, 5);
  world = step(map, world);
  const dead = heroOf(world, 1);
  assert.deepEqual([dead.hp, dead.respawn], [0, respawnSteps(3)]);
  assert.deepEqual(
    world.events.find((e) => e.type === "heroDeath"),
    { type: "heroDeath", seat: 1, killer: 0, x: at(8), y: at(5) },
  );
  assert.ok(heroOf(world, 0).xp > 0, "the killer's hero earned XP");
  // A dead hero is no target and takes no flag; a checkpoint keeps it dead.
  assert.deepEqual(decodeWorld(encodeWorld(world), map), {
    ...world,
    events: [],
  });
  world = run(world, respawnSteps(3) - 1);
  assert.equal(heroOf(world, 1).hp, 0);
  world = step(map, world);
  const back = heroOf(world, 1);
  assert.deepEqual(
    [back.hp, back.respawn, tileOf(back.x), tileOf(back.y)],
    [maxHp(3), 0, 12, 1],
  );
  assert.ok(world.events.some((e) => e.type === "respawn" && e.seat === 1));
});

test("a hero takes a flag for its seat and earns capture XP", () => {
  let world = createWorld(map, [0, 1], 1);
  const flag = map.flags[TINY.middle]!;
  world = withHero(world, 0, { x: at(flag.x), y: at(flag.y) });
  world = step(map, world);
  assert.equal(world.sectors[TINY.middle], 0);
  assert.equal(heroOf(world, 0).xp, CAPTURE_XP);
});

test("robots near their own living hero hit harder", () => {
  const shotBy = (world: World): number =>
    step(map, world).events.flatMap((e) =>
      e.type === "shot" && e.from.of === "unit" && e.from.id === 1
        ? [e.damage]
        : [],
    )[0]!;
  let world = createWorld(map, [0, 1], 1);
  world = add(world, 0, "torch", 6, 8);
  world = add(world, 1, "grunt", 7, 8, 1000);
  assert.equal(shotBy(world), UNITS.torch.damage);
  world = withHero(world, 0, { x: at(3), y: at(8) });
  assert.equal(shotBy(world), div(UNITS.torch.damage * AURA_DAMAGE, 100));
  assert.equal(
    shotBy(withHero(world, 0, { hp: 0, respawn: 5 })),
    UNITS.torch.damage,
  );
});

test("FOLLOW keeps a player's units near the hero, and at the fort while it is dead", () => {
  let world = createWorld(map, [0, 1], 1);
  world = withHero(world, 1, { x: at(12), y: at(8) });
  world = add(world, 0, "grunt", 2, 2);
  world = add(world, 0, "grunt", 2, 3);
  world = withHero(world, 0, { x: at(4), y: at(7) });
  world = run(world, 300, [{ seat: 0, type: "stance", stance: "follow" }]);
  for (const unit of world.units) {
    assert.equal(unit.goal, FOLLOW_HERO);
    assert.ok(tileOf(unit.y) >= 4, `unit ${unit.id} came south to its hero`);
  }
  world = run(withHero(world, 0, { hp: 0, respawn: 400 }), 300);
  for (const unit of world.units)
    assert.ok(tileOf(unit.y) <= 4, `unit ${unit.id} fell back to its fort`);
});

test("a hero's move commands cannot evict the flag and fort fields every stance uses", () => {
  const big = dustBasin();
  clearFlowCache(big);
  const world = createWorld(big, [0, 1], 1);
  const tile = (flag: { x: number; y: number }): number =>
    flag.y * big.width + flag.x;
  const flags = big.flags.map((flag) => flowField(big, tile(flag)));
  let next = world;
  let sent = 0;
  for (let y = 0; y < big.height; y++)
    for (let x = 0; x < big.width; x += 3) {
      if (big.sectorOf[y * big.width + x]! < 0) continue;
      next = stepTick(big, next, [{ seat: 0, type: "move", x, y }]);
      sent++;
    }
  assert.ok(sent > 10 * ROAMING_FLOW_CACHE_SIZE);
  big.flags.forEach((flag, index) =>
    assert.equal(flowField(big, tile(flag)), flags[index], "still cached"),
  );
  assert.ok(cachedFlowFields(big) <= FLOW_CACHE_SIZE + ROAMING_FLOW_CACHE_SIZE);
});

test("a living hero regenerates energy up to its level's most", () => {
  let world = withHero(createWorld(map, [0, 1], 1), 0, { energy: 10 });
  world = run(world, 10 * HERO.energyEvery);
  assert.equal(heroOf(world, 0).energy, 20);
  world = run(withHero(world, 0, { energy: HERO.energy }), HERO.energyEvery);
  assert.equal(heroOf(world, 0).energy, HERO.energy);
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const each of Object.values(value)) deepFreeze(each);
    Object.freeze(value);
  }
  return value;
};

test("hero steps leave the world they are given untouched and replay to the same hash", () => {
  const world = add(createWorld(map, [0, 1], 1), 1, "grunt", 6, 5);
  const commands: Command[] = [
    { seat: 0, type: "move", x: 6, y: 5 },
    { seat: 1, type: "steer", dx: -8, dy: 8 },
  ];
  const play = (from: World): string =>
    hashWorld(run(stepTick(map, from, commands), 400));
  const frozen = deepFreeze(structuredClone(world));
  assert.equal(play(frozen), play(structuredClone(world)));
  assert.deepEqual(frozen, world);
});
