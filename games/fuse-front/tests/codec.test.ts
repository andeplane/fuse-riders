import test from "node:test";
import assert from "node:assert/strict";
import {
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
];
const corruptions: [string, (wire: Wire) => unknown][] = [
  ["not a tuple", () => ({})],
  ["a short tuple", (w) => w.slice(0, 6)],
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
