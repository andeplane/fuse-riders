import test from "node:test";
import assert from "node:assert/strict";
import {
  DROP_HP,
  FORT_GUN,
  CAST_WAIT,
  HERO,
  MAX_XP,
  QUEUE_MAX,
  MINES_PER_HERO,
  MINE_FUSE,
  longest,
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
  // One team only (seats 0 and 2): with no stance to hold them back since v3, an enemy would pick the units off.
  let world = createWorld(map, [0, 2], 5);
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
        stun: 0,
        rally: 0,
        lane: -1,
        wave: 0,
      },
    ],
  };
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

test("every hero kind and its statuses round-trip", () => {
  const world = createWorld(map, [0, 1, 2], 5, {
    0: "vix",
    1: "tally",
    2: "rivet",
  });
  Object.assign(world.heroes[0]!, { cloak: 7 });
  Object.assign(world.heroes[1]!, {
    blitz: 3,
    flare: 4 * 14 + 4,
    flareLeft: 9,
  });
  world.mines.push({
    owner: 0,
    x: centreOf(4),
    y: centreOf(6),
    life: 30,
    stuck: -1,
  });
  world.fortified[1] = 12;
  world.overclock[0] = 40;
  assert.deepEqual(
    decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world))), map),
    world,
  );
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
  number[][],
  number[],
  number[],
];
/**
 * Hero 0's field `at` (seat, x, y, hp, energy, xp, cooldown, respawn, facing, goal, steerX, steerY, spells, quiet,
 * kind, cloak, blitz, flare, flareLeft).
 */
const hero =
  (...fields: [at: number, value: number][]) =>
  (w: Wire): Wire => {
    for (const [at, value] of fields) w[7][0]![at] = value;
    return w;
  };
/** Hero 0's queued orders (wire form, `orders.ts`) and the steps its first, a cast, has waited. */
const queued =
  (orders: unknown, wait = 0) =>
  (w: Wire): Wire => {
    const fields = w[7][0]! as unknown[];
    [fields[23], fields[24]] = [orders, wait];
    return w;
  };
/** A move, a cast with no target and one at unit 1, all on open tiles. */
const MOVE_44 = [0, 4, 4];
const CAST_44 = [3, 0, 4, 4, -1, -1];
const ROCK = 3 * 14 + 6;
const vix = hero([14, 1], [3, 100]);
const tally = hero([14, 3], [3, 100]);
const mine = (life = 10, stuck = -1) => [
  0,
  centreOf(4),
  centreOf(6),
  life,
  stuck,
];
const corruptions: [string, (wire: Wire) => unknown][] = [
  ["not a tuple", () => ({})],
  ["a short tuple", (w) => w.slice(0, 8)],
  ["a winner while every fort stands", (w) => ((w[8] = 0), w)],
  ["a string winner", (w) => ((w[8] = "-1" as unknown as number), w)],
  ["a factory at 0 hit points", (w) => ((w[5][TINY.robotFactory]![1] = 0), w)],
  [
    "a fort reloading too long",
    (w) => ((w[5][TINY.fort0]![4] = FORT_GUN.cooldown + 1), w),
  ],
  [
    "a ruined fort still reloading",
    (w) => ((w[5][TINY.fort0]![1] = 0), (w[5][TINY.fort0]![4] = 1), w),
  ],
  ["a factory reloading", (w) => ((w[5][TINY.robotFactory]![4] = 1), w)],
  [
    "a tank tougher than an Orbital Drop's",
    (w) => ((w[6][0]![1] = 2), (w[6][0]![5] = DROP_HP + 1), w),
  ],
  ["a grunt with a drop tank's armour", (w) => ((w[6][0]![5] = DROP_HP), w)],
  ["a hero calmer than calm", hero([13, HERO.calm + 1])],
  ["a hero with a negative calm", hero([13, -1])],
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
  ["a player on the wrong team", (w) => ((w[3][1]![1] = 1), w)],
  ["a player with a stance", (w) => (w[3][0]!.push(0), w)],
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
  ["a unit goal that is no goal", (w) => ((w[6][0]![7] = -4), w)],
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
  [
    "a top-level respawn past the cap",
    hero([5, MAX_XP], [3, 0], [7, HERO.respawnMax + 1]),
  ],
  ["a dead hero reloading", hero([3, 0], [7, 1], [6, 1])],
  ["a hero reloading too long", hero([6, HERO.cooldown + 1])],
  ["an unknown facing", hero([8, 8])],
  ["a move goal in rock", hero([9, ROCK])],
  ["a move goal off the map", hero([9, 14 * 10])],
  ["a stick held while a move is pending", hero([9, 4 * 14 + 4], [10, 1])],
  ["a stick pushed too far", hero([10, STEER_MAX + 1])],
  ["a fractional stick", hero([11, 0.5])],
  ["an unknown hero kind", hero([14, 4])],
  ["a cloak on a hero whose kit has none", hero([15, 5])],
  [
    "a cloak past its spell's",
    hero([14, 1], [3, 100], [15, longest("cloak") + 1]),
  ],
  ["a cloak on a dead hero", hero([14, 1], [3, 0], [7, 1], [15, 1])],
  ["a blitz on Vix", hero([14, 1], [3, 100], [16, 1])],
  ["a flare with no time left", hero([14, 3], [3, 100], [17, 4 * 14 + 4])],
  ["time left on no flare", hero([14, 3], [3, 100], [18, 5])],
  ["a flare in rock", hero([14, 3], [3, 100], [17, ROCK], [18, 5])],
  ["a mine of a seat that lays none", (w) => ((w[9] = [mine()]), w)],
  [
    "a mine past its fuse",
    (w) => (vix(w), (w[9] = [mine(MINE_FUSE + 1, 1)]), w),
  ],
  [
    "a mine stuck to a unit from the future",
    (w) => (vix(w), (w[9] = [mine(5, 9)]), w),
  ],
  ["a spent mine", (w) => (vix(w), (w[9] = [mine(0)]), w)],
  [
    "too many mines",
    (w) => (vix(w), (w[9] = Array(MINES_PER_HERO + 1).fill(mine())), w),
  ],
  [
    "a fortify past its spell's",
    (w) => ((w[10][0] = longest("fortify") + 1), w),
  ],
  ["a missing flag's fortify", (w) => ((w[10] = w[10].slice(1)), w)],
  ["one team's overclock", (w) => ((w[11] = [0]), w)],
  [
    "an overclock past its spell's",
    (w) => ((w[11][1] = longest("overclock") + 1), w),
  ],
  ["a seat with no fort on the map", (w) => (w[3].push([3, 1, 0]), w)],
  ["a queue that is no list", queued(5)],
  ["a queue past its most", queued(Array(QUEUE_MAX + 1).fill(MOVE_44))],
  ["an unknown order kind", queued([[4, 4, 4]])],
  ["a queued move into rock", queued([[0, 6, 3]])],
  ["a queued move off the map", queued([[1, 14, 4]])],
  ["a queued move with an extra field", queued([[0, 4, 4, 1]])],
  ["a queued attack on a friend", queued([[2, 1, 2]])],
  ["a queued attack on a unit from the future", queued([[2, 0, 9]])],
  ["a queued attack on a factory", queued([[2, 2, TINY.robotFactory]])],
  ["a queued cast of a fifth slot", queued([[3, 4, 4, 4, -1, -1]])],
  ["a queued cast with half a target", queued([[3, 0, 4, 4, 0, -1]])],
  ["a queued cast at no site", queued([[3, 0, 4, 4, 2, 99]])],
  ["a queued cast at a unit from the future", queued([[3, 0, 4, 4, 0, 9]])],
  ["a wait with no cast first", queued([MOVE_44, CAST_44], 1)],
  ["a wait past its most", queued([CAST_44], CAST_WAIT)],
  ["a wait on an empty queue", queued([], 1)],
  [
    "a dead hero waiting to cast",
    (w) => queued([CAST_44], 1)(hero([3, 0], [7, 1])(w)),
  ],
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

test("a hero's queue round-trips, and the queue corruptions start from checkpoints that decode", () => {
  const wire = () => structuredClone(encodeWorld(played())) as Wire;
  const orders = [
    MOVE_44,
    [1, 4, 4],
    [2, 2, TINY.turret],
    CAST_44,
    [3, 2, 4, 4, 0, 1],
  ];
  const world = decodeWorld(queued([...orders].reverse(), 0)(wire()), map);
  assert.ok(world);
  assert.deepEqual(world.heroes[0]!.queue.at(-1), { type: "move", x: 4, y: 4 });
  assert.deepEqual(world.heroes[0]!.queue[0], {
    type: "cast",
    slot: 2,
    x: 4,
    y: 4,
    of: 0,
    id: 1,
  });
  assert.deepEqual(
    (encodeWorld(world) as Wire)[7][0]![23],
    [...orders].reverse(),
  );
  assert.ok(
    decodeWorld(queued([CAST_44, MOVE_44], CAST_WAIT - 1)(wire()), map),
  );
  assert.ok(decodeWorld(queued([MOVE_44])(hero([3, 0], [7, 1])(wire())), map));
});

test("the kit corruptions start from checkpoints that decode", () => {
  const wire = () => structuredClone(encodeWorld(played())) as Wire;
  const flare = hero([17, 4 * 14 + 4], [18, 5]);
  for (const fix of [vix, tally, (w: Wire) => flare(tally(w))])
    assert.ok(decodeWorld(fix(wire()), map));
  const mined = vix(wire());
  mined[9] = [mine(MINE_FUSE, 1)];
  assert.ok(decodeWorld(mined, map));
});
