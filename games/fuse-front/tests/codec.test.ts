import test from "node:test";
import assert from "node:assert/strict";
import {
  HERO,
  MAX_XP,
  STEER_MAX,
  maxEnergy,
  maxHp,
  respawnSteps,
  TILE,
  TURRET,
  UNIT_CAP,
  centreOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  hashWorld,
  step,
  type World,
} from "../src/engine/index.js";
import { TINY, dustBasin, tiny } from "./fixtures/maps.js";

const map = tiny();

function played(): World {
  let world = createWorld(map, [0, 1, 2], 5);
  const flag = map.flags[TINY.middle]!;
  world = {
    ...world,
    nextId: 2,
    units: [
      {
        id: 1,
        kind: "grunt",
        owner: 0,
        x: centreOf(flag.x),
        y: centreOf(flag.y),
        hp: 60,
        cooldown: 0,
        goal: -1,
      },
    ],
  };
  world = step(map, world, [{ seat: 1, type: "stance", stance: "follow" }]);
  for (let index = 0; index < 500; index++) world = step(map, world);
  return world;
}

test("a world round-trips through its canonical encoding, hash and all", () => {
  const world = played();
  assert.ok(world.units.length > 1);
  const wire = JSON.parse(JSON.stringify(encodeWorld(world)));
  const back = decodeWorld(wire, map);
  assert.deepEqual(back, world);
  assert.equal(hashWorld(back!), hashWorld(world));
  assert.match(hashWorld(world), /^[0-9a-f]{8}$/);
  // The decoded world shares nothing with the wire.
  wire[4][0] = 2;
  assert.equal(back!.sectors[0], world.sectors[0]);
});

test("a fresh Dust Basin world round-trips too", () => {
  const dust = dustBasin();
  const world = createWorld(dust, [0, 1, 2, 3, 4, 5], 1);
  assert.deepEqual(decodeWorld(encodeWorld(world), dust), world);
});

type Wire = [
  number,
  number,
  number,
  number[][],
  number[],
  number[][],
  number[][],
  number[][],
  number,
];
/** Hero 0's field `at` (seat, x, y, hp, energy, xp, cooldown, respawn, facing, goal, steerX, steerY). */
const hero =
  (...fields: [at: number, value: number][]) =>
  (w: Wire): Wire => {
    for (const [at, value] of fields) w[7][0]![at] = value;
    return w;
  };
const ROCK = 3 * 14 + 6;
const corruptions: [string, (wire: Wire) => unknown][] = [
  ["not a tuple", () => ({})],
  ["a short tuple", (w) => w.slice(0, 8)],
  ["a winner while every fort stands", (w) => ((w[8] = 0), w)],
  ["a string winner", (w) => ((w[8] = "-1" as unknown as number), w)],
  [
    "a fallen fort with no winner recorded",
    (w) => ((w[5][TINY.fort1]![1] = 0), w),
  ],
  ["a factory at 0 hit points", (w) => ((w[5][TINY.robotFactory]![1] = 0), w)],
  ["a reloading fort", (w) => ((w[5][TINY.fort0]![4] = 1), w)],
  [
    "a turret cooling down too long",
    (w) => ((w[5][TINY.turret]![4] = TURRET.cooldown + 1), w),
  ],
  [
    "a ruined turret still cooling down",
    (w) => ((w[5][TINY.turret]![1] = 0), (w[5][TINY.turret]![4] = 1), w),
  ],
  ["a unit cooling down too long", (w) => ((w[6][0]![6] = 9999), w)],
  ["a negative cooldown", (w) => ((w[6][0]![6] = -1), w)],
  ["a draw recorded while a fort stands", (w) => ((w[8] = 2), w)],
  ["a building missing its cooldown", (w) => (w[5][0]!.pop(), w)],
  ["a fractional step", (w) => ((w[0] = 1.5), w)],
  ["a string rng", (w) => ((w[1] = "7" as unknown as number), w)],
  ["one player", (w) => ((w[3] = w[3].slice(0, 1)), w)],
  ["a player on the wrong team", (w) => ((w[3][1]![1] = 0), w)],
  ["an unknown stance", (w) => ((w[3][0]![2] = 9), w)],
  ["players out of order", (w) => (w[3].reverse(), w)],
  ["a sector held by an absent seat", (w) => ((w[4][2] = 5), w)],
  ["a missing sector", (w) => ((w[4] = w[4].slice(1)), w)],
  ["a missing building", (w) => ((w[5] = w[5].slice(1)), w)],
  ["an unknown site", (w) => ((w[5][w[5].length - 1]![0] = 99), w)],
  ["a factory ordered a tank", (w) => ((w[5][TINY.robotFactory]![2] = 2), w)],
  ["a turret with an order", (w) => ((w[5][TINY.turret]![2] = 0), w)],
  [
    "a finished batch left standing",
    (w) => ((w[5][TINY.robotFactory]![3] = 48000), w),
  ],
  ["overfull hit points", (w) => ((w[5][0]![1] = 99999), w)],
  ["a unit of an absent seat", (w) => ((w[6][0]![2] = 3), w)],
  ["a unit off the map", (w) => ((w[6][0]![3] = -1), w)],
  [
    "a unit standing in rock",
    (w) => ((w[6][0]![3] = 6 * TILE + 8), (w[6][0]![4] = 3 * TILE + 8), w),
  ],
  ["a goal in rock", (w) => ((w[6][0]![7] = 3 * 14 + 6), w)],
  ["a goal off the map", (w) => ((w[6][0]![7] = 14 * 10), w)],
  ["a goal on plain ground", (w) => ((w[6][0]![7] = 4 * 14 + 4), w)],
  ["a unit goal that is no goal", (w) => ((w[6][0]![7] = -3), w)],
  ["a missing hero", (w) => ((w[7] = w[7].slice(1)), w)],
  ["heroes out of order", (w) => (w[7].reverse(), w)],
  ["a hero of another seat", hero([0, 3])],
  ["a hero missing a field", (w) => (w[7][0]!.pop(), w)],
  ["a hero in rock", hero([1, 6 * TILE + 8], [2, 3 * TILE + 8])],
  ["a hero over its level's hit points", hero([5, 0], [3, maxHp(1) + 1])],
  ["a hero over its level's energy", hero([5, 0], [4, maxEnergy(1) + 1])],
  ["XP past the top level", hero([5, MAX_XP + 1])],
  ["a living hero with a respawn timer", hero([7, 5])],
  ["a dead hero with no respawn timer", hero([3, 0])],
  [
    "a respawn longer than the level's",
    hero([5, 0], [3, 0], [7, respawnSteps(1) + 1]),
  ],
  ["a dead hero reloading", hero([3, 0], [7, 1], [6, 1])],
  ["a hero reloading too long", hero([6, HERO.cooldown + 1])],
  ["an unknown facing", hero([8, 8])],
  ["a move goal in rock", hero([9, ROCK])],
  ["a move goal off the map", hero([9, 14 * 10])],
  ["a stick pushed too far", hero([10, STEER_MAX + 1])],
  ["a fractional stick", hero([11, 0.5])],
  ["a seat with no fort on the map", (w) => (w[3].push([3, 1, 0]), w)],
  ["a dead unit", (w) => ((w[6][0]![5] = 0), w)],
  ["units out of order", (w) => (w[6].reverse(), w)],
  ["a unit id from the future", (w) => ((w[2] = 2), w)],
  ["NaN", (w) => ((w[6][0]![3] = Number.NaN), w)],
  [
    "a player over the unit cap",
    (w) => {
      const unit = w[6][0]!;
      w[6] = Array.from({ length: UNIT_CAP + 1 }, (_, index) => [
        index + 1,
        ...unit.slice(1),
      ]);
      w[2] = UNIT_CAP + 2;
      return w;
    },
  ],
];

for (const [label, corrupt] of corruptions)
  test(`a checkpoint with ${label} is refused`, () => {
    const world = played();
    const before = hashWorld(world);
    const wire = structuredClone(encodeWorld(world)) as Wire;
    assert.equal(decodeWorld(corrupt(wire), map), undefined);
    assert.equal(hashWorld(world), before);
  });
