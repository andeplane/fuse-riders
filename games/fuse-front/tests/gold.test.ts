import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNTAIN,
  GOLD,
  MAX_SEATS,
  NEUTRAL,
  STEPS_PER_SECOND,
  TILE,
  atFountain,
  bountyOf,
  centreOf,
  createWorld,
  decodeWorld,
  div,
  earn,
  encodeWorld,
  heroBounty,
  lastHit,
  maxHp,
  step,
  type World,
} from "../src/engine/index.js";
import { addUnit, arena, benchHeroes } from "./fixtures/heroes.js";
import { TINY, tiny } from "./fixtures/maps.js";
import { mapById } from "../src/online/maps.js";

const map = tiny();
const gold = (world: World, seat: number) =>
  world.heroes.find((h) => h.seat === seat)!.gold;

test("every hero starts with gold and earns the trickle each second, dead or alive", () => {
  let world = arena("brick");
  assert.deepEqual(
    world.heroes.map((h) => h.gold),
    [GOLD.start, GOLD.start],
  );
  for (let index = 0; index < STEPS_PER_SECOND; index++)
    world = step(map, world);
  assert.deepEqual(
    world.heroes.map((h) => h.gold),
    [GOLD.start + GOLD.trickle, GOLD.start + GOLD.trickle],
  );
});

test("a hero's shot on the step a unit dies earns its last hit, even beside a robot's", () => {
  const world = arena("brick");
  addUnit(world, 1, "grunt", 7, 6, 1);
  const next = step(map, world);
  assert.equal(next.units.length, 0);
  assert.equal(gold(next, 0), GOLD.start + GOLD.lastHit.grunt);
  // A friendly robot shoots first (units before heroes); the hero's shot on the same step still lands the blow.
  const shared = arena("brick");
  addUnit(shared, 0, "grunt", 5, 6);
  addUnit(shared, 1, "torch", 7, 6, 1);
  assert.equal(gold(step(map, shared), 0), GOLD.start + GOLD.lastHit.torch);
});

test("a kill the hero's shot did not land pays it nothing", () => {
  const world = arena("brick");
  world.heroes[0]!.cooldown = 10;
  addUnit(world, 0, "grunt", 5, 6);
  addUnit(world, 1, "grunt", 7, 6, 1);
  const next = step(map, world);
  assert.equal(next.units.length, 1, "the robot killed it");
  assert.equal(gold(next, 0), GOLD.start);
});

test("a camp guard pays the guard's gold; no seat earns from a kill no hero made", () => {
  const world = arena("brick");
  lastHit(world, 0, "sentry", NEUTRAL);
  assert.equal(gold(world, 0), GOLD.start + GOLD.guard);
  lastHit(world, 0, "sentry", 1);
  assert.equal(gold(world, 0), GOLD.start + GOLD.guard + GOLD.lastHit.sentry);
});

test("gold stops at its most", () => {
  const world = arena("brick");
  earn(world.heroes[0]!, GOLD.max);
  assert.equal(gold(world, 0), GOLD.max);
});

test("a hero kill pays a bounty that grows with the victim's streak, and the killer's streak grows", () => {
  const world = arena("brick");
  Object.assign(world.heroes[1]!, {
    hp: 1,
    respawn: 0,
    x: centreOf(7),
    y: centreOf(6),
    streak: 2,
  });
  const next = step(map, world);
  const [killer, victim] = next.heroes;
  assert.equal(victim!.hp, 0);
  assert.equal(killer!.gold, GOLD.start + GOLD.hero + 2 * GOLD.perStreak);
  assert.deepEqual([killer!.streak, victim!.streak], [1, 0]);
  assert.ok(
    victim!.hurt.every((left) => left === 0),
    "its hits cleared",
  );
  assert.equal(bountyOf(99), GOLD.hero + GOLD.streakMax * GOLD.perStreak);
});

test("a hero's hit on a hero counts toward an assist for the window", () => {
  const world = arena("brick");
  Object.assign(world.heroes[1]!, {
    hp: 500,
    respawn: 0,
    x: centreOf(7),
    y: centreOf(6),
  });
  const next = step(map, world);
  assert.equal(next.heroes[1]!.hurt[0], GOLD.assistWindow);
  assert.equal(world.heroes[1]!.hurt[0], 0, "the step left its input alone");
  assert.equal(step(map, next).heroes[1]!.hurt[0]! < GOLD.assistWindow, true);
});

test("assists split their share among the killer's near, living teammates that hit the victim", () => {
  const crown = mapById("crown-jungle");
  const world = createWorld(crown, [0, 1, 2, 3, 4, 5], 1);
  const [h0, h1, h2, h3, h4] = world.heroes;
  const spot = { x: 100 * TILE, y: 100 * TILE };
  const hits = Array.from({ length: MAX_SEATS }, () => 0);
  hits[2] = hits[4] = 5;
  Object.assign(h1!, { ...spot, hurt: hits, streak: 1 });
  Object.assign(h2!, { x: spot.x + 2 * TILE, y: spot.y });
  // Seat 4 hit it too but stands far off; seat 3 is the victim's own team.
  Object.assign(h4!, { x: spot.x + 20 * TILE, y: spot.y });
  Object.assign(h3!, spot);
  heroBounty(world, h1!, 0);
  const bounty = GOLD.hero + GOLD.perStreak;
  assert.equal(h0!.gold, GOLD.start + bounty);
  assert.equal(h2!.gold, GOLD.start + div(bounty * GOLD.assistPercent, 100));
  assert.deepEqual(
    [h3!.gold, h4!.gold, h1!.gold],
    [GOLD.start, GOLD.start, GOLD.start],
  );
  // Two helpers split it evenly.
  const again = createWorld(crown, [0, 1, 2, 3, 4, 5], 1);
  Object.assign(again.heroes[1]!, { ...spot, hurt: hits });
  Object.assign(again.heroes[2]!, spot);
  Object.assign(again.heroes[4]!, spot);
  heroBounty(again, again.heroes[1]!, 0);
  const share = div(div(GOLD.hero * GOLD.assistPercent, 100), 2);
  assert.deepEqual(
    [again.heroes[2]!.gold, again.heroes[4]!.gold],
    [GOLD.start + share, GOLD.start + share],
  );
});

test("a razed lane tower pays every hero of the razer's team", () => {
  const crown = mapById("crown-jungle");
  const world = benchHeroes(createWorld(crown, [0, 1, 2, 3, 4, 5], 1));
  const site = crown.sites.find(
    (s) => s.lane >= 0 && s.team === 1 && s.tier === 0,
  )!;
  world.buildings.find((b) => b.id === site.id)!.hp = 1;
  Object.assign(world.heroes[0]!, {
    hp: maxHp(10),
    respawn: 0,
    x: centreOf(site.x),
    y: centreOf(site.y),
  });
  const next = step(crown, world);
  assert.ok(next.events.some((e) => e.type === "destroyed"));
  assert.deepEqual(
    next.heroes.map((h) => h.gold - GOLD.start),
    [0, 1, 2, 3, 4, 5].map((seat) => (seat % 2 === 0 ? GOLD.tower[0] : 0)),
  );
});

test("taking a flag pays the taker", () => {
  const world = arena("brick");
  const flag = map.flags[TINY.middle]!;
  Object.assign(world.heroes[0]!, {
    x: centreOf(flag.x),
    y: centreOf(flag.y),
  });
  const next = step(map, world);
  assert.equal(next.sectors[TINY.middle], 0);
  assert.equal(gold(next, 0), GOLD.start + GOLD.capture);
});

test("the fountain heals and refills a living hero in its own courtyard, and nowhere else", () => {
  const world = arena("brick");
  Object.assign(world.heroes[0]!, { hp: 100, energy: 10, quiet: 0 });
  const away = step(map, world).heroes[0]!;
  assert.deepEqual([away.hp, away.energy], [100, 10]);
  const fort = map.sites[TINY.fort0]!;
  Object.assign(world.heroes[0]!, { x: centreOf(fort.x), y: centreOf(fort.y) });
  assert.ok(atFountain(map, world.heroes[0]!));
  const home = step(map, world).heroes[0]!;
  assert.deepEqual(
    [home.hp, home.energy],
    [100 + div(maxHp(1) * FOUNTAIN.hpPermille, 1000), 10 + FOUNTAIN.energy],
  );
  let full = world;
  for (let index = 0; index < 10 * STEPS_PER_SECOND; index++)
    full = step(map, full);
  assert.equal(full.heroes[0]!.hp, maxHp(1), "capped at its most");
});

/** The hero tuple's gold fields (`codec.ts`): gold, streak and the hits by seat. */
const GOLD_AT = 25;
/** A fresh tiny match with seat 1's hero fallen, as a checkpoint that decodes. */
function wireOf(): unknown[] {
  const world = createWorld(map, [0, 1], 1);
  Object.assign(world.heroes[1]!, { hp: 0, respawn: 1 });
  const wire = structuredClone(encodeWorld(world)) as unknown[];
  assert.ok(decodeWorld(structuredClone(wire), map));
  return wire;
}
const corrupt: [string, (hero: unknown[]) => void][] = [
  ["negative gold", (h) => (h[GOLD_AT] = -1)],
  ["gold past its most", (h) => (h[GOLD_AT] = GOLD.max + 1)],
  ["fractional gold", (h) => (h[GOLD_AT] = 1.5)],
  ["a streak past its most", (h) => (h[GOLD_AT + 1] = GOLD.streakMax + 1)],
  ["hits for too few seats", (h) => (h[GOLD_AT + 2] = [0, 0])],
  ["a hit longer than the window", (h) => hurt(h, 1, GOLD.assistWindow + 1)],
  ["a hit by its own team", (h) => hurt(h, 2, 5)],
  ["a hit by a seat not in play", (h) => hurt(h, 3, 5)],
  ["no hits list", (h) => (h[GOLD_AT + 2] = 7)],
];
function hurt(hero: unknown[], seat: number, left: number): void {
  const hits = [...(hero[GOLD_AT + 2] as number[])];
  hits[seat] = left;
  hero[GOLD_AT + 2] = hits;
}

test("gold, the streak and the hits round-trip through a checkpoint", () => {
  const world = createWorld(map, [0, 1], 1);
  const hits = Array.from({ length: MAX_SEATS }, () => 0);
  hits[1] = 7;
  Object.assign(world.heroes[0]!, { gold: 1234, streak: 3, hurt: hits });
  const back = decodeWorld(structuredClone(encodeWorld(world)), map)!;
  assert.deepEqual(
    [back.heroes[0]!.gold, back.heroes[0]!.streak, back.heroes[0]!.hurt],
    [1234, 3, hits],
  );
});

for (const [label, change] of corrupt)
  test(`a checkpoint with ${label} is refused`, () => {
    const wire = wireOf();
    change((wire[7] as unknown[][])[0]!);
    assert.equal(decodeWorld(wire, map), undefined);
  });

test("a checkpoint with a fallen hero still counting hits is refused", () => {
  const wire = wireOf();
  hurt((wire[7] as unknown[][])[1]!, 0, 5);
  assert.equal(decodeWorld(wire, map), undefined);
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const each of Object.values(value)) deepFreeze(each);
    Object.freeze(value);
  }
  return value;
};

test("a step with hero hits, a hero kill and a last hit leaves its input untouched", () => {
  const world = arena("brick");
  Object.assign(world.heroes[1]!, {
    hp: 30,
    respawn: 0,
    x: centreOf(7),
    y: centreOf(6),
  });
  addUnit(world, 1, "grunt", 6, 7, 1);
  const frozen = deepFreeze(structuredClone(world));
  let next = step(map, frozen);
  for (let index = 0; index < 60; index++) next = step(map, next);
  assert.deepEqual(frozen, world);
  assert.ok(gold(next, 0) > GOLD.start + GOLD.hero, "it earned a kill");
});

test("a spell's kill is its caster's last hit, and SNIPE counts toward an assist", () => {
  const world = arena("brick");
  world.heroes[0]!.cooldown = 99;
  addUnit(world, 1, "grunt", 5, 6, 1);
  const shock = step(map, world, [
    { seat: 0, type: "cast", slot: 0, x: 4, y: 6 },
  ]);
  assert.equal(shock.units.length, 0);
  assert.equal(gold(shock, 0), GOLD.start + GOLD.lastHit.grunt);
  const vix = arena("vix");
  Object.assign(vix.heroes[1]!, {
    hp: 5000,
    respawn: 0,
    x: centreOf(9),
    y: centreOf(6),
  });
  vix.heroes[0]!.cooldown = 99;
  const sniped = step(map, vix, [
    { seat: 0, type: "cast", slot: 0, x: 9, y: 6, of: 1, id: 1 },
  ]);
  assert.ok(sniped.events.some((e) => e.type === "cast"));
  // A cast lands before the step's countdown (`tendGold`), a shot after it.
  assert.equal(sniped.heroes[1]!.hurt[0], GOLD.assistWindow - 1);
});
