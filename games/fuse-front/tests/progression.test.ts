import test from "node:test";
import assert from "node:assert/strict";
import {
  COMEBACK_MAX,
  COMEBACK_XP,
  HERO,
  HERO_KINDS,
  KITS,
  LEVEL_XP,
  MAX_LEVEL,
  MAX_XP,
  RANK_TWO,
  STEPS_PER_SECOND,
  STRUCTURE_XP,
  TILE,
  ULTIMATE_LEVEL,
  XP_GROUP,
  XP_RADIUS,
  award,
  centreOf,
  comebackOf,
  createWorld,
  div,
  hashWorld,
  heroShot,
  levelOf,
  levelXp,
  maxEnergy,
  maxHp,
  openTile,
  rankedCooldown,
  respawnSteps,
  step,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { tiny } from "./fixtures/maps.js";
import { arena, benchHeroes, fire } from "./fixtures/heroes.js";
import { mapById } from "../src/online/maps.js";

/**
 * Hero progression (v3 M4): XP shared near a death, levels 1–12 with an ultimate at 6 and second spell ranks, a
 * respawn that grows with level up to a cap, the comeback XP and same-level duels that last seconds.
 */
const map = tiny();
const duel = mapById("neon-duel");

/** Seats 0 and 2 (team 0) and 1 (team 1) on the tiny map, each hero placed at a sub-pixel spot. */
function three(spots: [number, number][]): World {
  const world = createWorld(map, [0, 1, 2], 1);
  world.heroes.forEach((hero, index) => {
    [hero.x, hero.y] = spots[index]!;
  });
  return world;
}
const xps = (world: World): number[] => world.heroes.map((hero) => hero.xp);

test("a death's XP goes to the killing team's living heroes within XP_RADIUS, split with a group bonus", () => {
  const [x, y] = [centreOf(4), centreOf(4)];
  // Seat 0 on the edge of the radius, seat 2 a sub-pixel beyond it, the enemy beside the death.
  let world = three([
    [x + XP_RADIUS, y],
    [x, y],
    [x, y + XP_RADIUS + 1],
  ]);
  award(map, world, 2, 1, x, y, 100);
  assert.deepEqual(xps(world), [100, 0, 0], "alone: all of it, whoever killed");
  world = three([
    [x + TILE, y],
    [x, y],
    [x, y + TILE],
  ]);
  award(map, world, 0, 1, x, y, 100);
  const pair = div(100 * (100 + XP_GROUP), 200);
  assert.deepEqual(xps(world), [pair, 0, pair], "two: 65 percent each");
  world.heroes[2]!.hp = 0;
  award(map, world, 0, 1, x, y, 100);
  assert.deepEqual(xps(world), [pair + 100, 0, pair], "the dead earn nothing");
  // A neutral's death pays the killer's team; a kill no seat made pays nobody.
  world = three([
    [x, y],
    [x, y],
    [x, y],
  ]);
  award(map, world, 1, -1, x, y, 40);
  assert.deepEqual(xps(world), [0, 40, 0]);
  award(map, world, -1, 1, x, y, 40);
  assert.deepEqual(xps(world), [0, 40, 0]);
});

test("levels run 1 to 12 on a fast early curve, each raising every hero's hit points, gun and energy", () => {
  assert.equal(MAX_LEVEL, 12);
  assert.equal(LEVEL_XP.length, MAX_LEVEL + 1);
  assert.equal(MAX_XP, levelXp(MAX_LEVEL));
  for (let level = 2; level <= MAX_LEVEL; level++) {
    assert.ok(levelXp(level) > levelXp(level - 1), `level ${level}`);
    // Each level asks at least as much more as the one before it.
    if (level > 2)
      assert.ok(
        levelXp(level) - levelXp(level - 1) >=
          levelXp(level - 1) - levelXp(level - 2),
      );
    assert.equal(levelOf(levelXp(level)), level);
    assert.equal(levelOf(levelXp(level) - 1), level - 1);
    for (const kind of HERO_KINDS) {
      assert.ok(maxHp(level, kind) > maxHp(level - 1, kind), kind);
      assert.ok(
        heroShot(level, kind).damage > heroShot(level - 1, kind).damage,
      );
    }
    assert.ok(maxEnergy(level) > maxEnergy(level - 1));
  }
  assert.equal(levelOf(MAX_XP * 2), MAX_LEVEL);
});

test("the ultimate unlocks at 6; basic spells reach rank 2 at 9 and ultimates at 12, cooling a quarter faster", () => {
  for (const kind of HERO_KINDS) {
    const kit = KITS[kind];
    assert.equal(kit[3]!.unlock, ULTIMATE_LEVEL, kind);
    assert.ok(kit.slice(0, 3).every((spell) => spell.unlock === 1));
  }
  const rank2 = (cooldown: number) => div(cooldown * RANK_TWO.cooldown, 100);
  // Brick's SHOCKWAVE and Rivet's OVERCLOCK, cast at the levels either side of each rank.
  const cooled = (kind: HeroKind, slot: number, level: number) => {
    const [cast, next] = fire(arena(kind, level), slot);
    return cast ? next.heroes[0]!.spells[slot] : undefined;
  };
  const shockwave = KITS.brick[0]!.cooldown;
  assert.equal(cooled("brick", 0, RANK_TWO.basic - 1), shockwave);
  assert.equal(cooled("brick", 0, RANK_TWO.basic), rank2(shockwave));
  const overclock = KITS.rivet[3]!.cooldown;
  assert.equal(cooled("rivet", 3, ULTIMATE_LEVEL - 1), undefined);
  assert.equal(cooled("rivet", 3, RANK_TWO.ultimate - 1), overclock);
  assert.equal(cooled("rivet", 3, RANK_TWO.ultimate), rank2(overclock));
  assert.equal(rankedCooldown(KITS.vix[0]!, 1), KITS.vix[0]!.cooldown);
});

test("respawn: a base plus a step per level, capped at respawnMax", () => {
  const s = STEPS_PER_SECOND;
  assert.deepEqual(
    [1, 2, 6, 8, 9, 12].map((level) => respawnSteps(level) / s),
    [8, 12, 28, 36, 40, 40],
  );
  assert.equal(respawnSteps(MAX_LEVEL), HERO.respawnMax);
});

test("comeback: a team behind on razed lane structures takes more XP, up to the cap", () => {
  let world = benchHeroes(createWorld(duel, [0, 1], 1));
  const ours = world.buildings.filter(
    (building) => duel.sites[building.id]!.team === 0,
  );
  assert.ok(ours.length >= 3);
  assert.deepEqual(
    [comebackOf(duel, world, 0), comebackOf(duel, world, 1)],
    [100, 100],
  );
  for (let razed = 1; razed <= 3; razed++) {
    ours[razed - 1]!.hp = 0;
    const bonus =
      COMEBACK_XP * razed < COMEBACK_MAX ? COMEBACK_XP * razed : COMEBACK_MAX;
    assert.equal(comebackOf(duel, world, 0), 100 + bonus);
    assert.equal(comebackOf(duel, world, 1), 100);
  }
  world = {
    ...world,
    heroes: world.heroes.map((hero) => ({ ...hero, hp: 100, xp: 0 })),
  };
  const [x, y] = [world.heroes[0]!.x, world.heroes[0]!.y];
  award(duel, world, 0, 1, x, y, 100);
  assert.equal(world.heroes[0]!.xp, 100 + COMEBACK_MAX);
  // The comeback multiplies a shared split too: two near a death of 100 XP take 65 percent each, times 130.
  const [first, foe] = world.heroes.map((hero) => ({ ...hero, x, y, xp: 0 }));
  const three = { ...world, heroes: [first!, foe!, { ...first!, seat: 2 }] };
  award(duel, three, 0, 1, x, y, 100);
  const share = div(
    100 * div((100 + XP_GROUP) * (100 + COMEBACK_MAX), 100),
    200,
  );
  assert.deepEqual(xps(three), [share, 0, share]);
});

test("a razed lane tower's XP goes to the razing team's heroes near it; the step is pure and replays", () => {
  const world = benchHeroes(createWorld(duel, [0, 1], 1));
  const site = duel.sites.find(
    (each) => each.team === 1 && each.tier === 0 && each.lane >= 0,
  )!;
  world.buildings.find((building) => building.id === site.id)!.hp = 1;
  // Seat 0's hero alive at level 1 on open ground within its gun's reach of the tower.
  const hero = world.heroes[0]!;
  let spot: [number, number] | undefined;
  for (let dy = -3; dy <= 3 && !spot; dy++)
    for (let dx = -3; dx <= 3 && !spot; dx++)
      if (openTile(duel, site.x + dx, site.y + dy) && (dx !== 0 || dy !== 0))
        spot = [site.x + dx, site.y + dy];
  Object.assign(hero, {
    x: centreOf(spot![0]),
    y: centreOf(spot![1]),
    hp: maxHp(1),
    xp: 0,
    respawn: 0,
  });
  const before = structuredClone(world);
  const next = step(duel, world);
  assert.deepEqual(world, before, "the step leaves its input untouched");
  assert.equal(hashWorld(step(duel, structuredClone(before))), hashWorld(next));
  assert.ok(next.events.some((event) => event.type === "destroyed"));
  assert.equal(next.heroes[0]!.xp, STRUCTURE_XP[0]);
});

/**
 * Same-level duels without items: seat 0's `a` shoots seat 1's `b`, which holds fire, 5 tiles apart on the tiny map.
 * Returns the shots it took, which at one shot a second is the time-to-kill in seconds.
 */
function shotsToKill(a: HeroKind, b: HeroKind, level: number): number {
  let world = createWorld(map, [0, 1], 1, { 0: a, 1: b });
  const [hunter, prey] = world.heroes as [
    World["heroes"][0],
    World["heroes"][0],
  ];
  Object.assign(hunter, { x: centreOf(3), y: centreOf(4), xp: levelXp(level) });
  Object.assign(prey, { x: centreOf(8), y: centreOf(4), xp: levelXp(level) });
  [hunter.hp, prey.hp] = [maxHp(level, a), maxHp(level, b)];
  let shots = 0;
  for (let steps = 0; steps < 20 * STEPS_PER_SECOND; steps++) {
    world.heroes[1]!.cooldown = HERO.cooldown;
    world = step(map, world);
    shots += world.events.filter(
      (event) =>
        event.type === "shot" &&
        event.from.of === "hero" &&
        event.to.of === "hero" &&
        event.to.id === 1,
    ).length;
    if (world.heroes[1]!.hp === 0) return shots;
  }
  return Infinity;
}

test("a same-level duel without items takes 4–8 shots, a second each, at levels 1, 6 and 12", (t) => {
  assert.equal(HERO.cooldown, STEPS_PER_SECOND);
  const out: string[] = [];
  for (const level of [1, 6, 12])
    for (const a of HERO_KINDS)
      for (const b of HERO_KINDS) {
        const shots = shotsToKill(a, b, level);
        out.push(`L${level} ${a}>${b} ${shots}`);
        assert.ok(
          shots >= 4 && shots <= 8,
          `${a} on ${b} at ${level}: ${shots}`,
        );
      }
  t.diagnostic(out.join(", "));
});
