import test from "node:test";
import assert from "node:assert/strict";
import {
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { BOUNDS } from "../src/engine/arena.js";
import * as T from "../src/engine/tuning.js";

/** A busy world: five bots a while into a round, with carts, wagons, guards and effects about. */
function busy(): World {
  const world = createWorld(
    4242,
    [0, 1, 2, 3, 4].map((slot) => ({ id: `bot:${slot + 1}`, slot })),
    { seconds: 75 },
  );
  let inputs = new Map<string, number>();
  for (let step = 0; step < 1500; step++) {
    if (step % 3 === 0)
      inputs = new Map(world.trains.map((t) => [t.id, botInput(world, t)]));
    stepWorld(world, inputs);
  }
  return world;
}

const tamper = (raw: unknown[], path: number[], value: unknown): unknown[] => {
  const copy = structuredClone(raw);
  let node: unknown[] = copy;
  for (const index of path.slice(0, -1)) node = node[index] as unknown[];
  node[path.at(-1)!] = value;
  return copy;
};

test("a world survives the checkpoint whole, through MessagePack-shaped plain data", () => {
  const world = busy();
  assert.ok(
    world.carts.length > 0 && world.trains.some((t) => t.cargo.length > 0),
  );
  const raw = structuredClone(encodeWorld(world));
  const back = decodeWorld(raw)!;
  assert.deepEqual(back, world);
  assert.deepEqual(encodeWorld(back), encodeWorld(world));
  // The decoded world is a copy: changing it leaves the fields it came from alone.
  back.trains[0]!.trail[0] = 0;
  assert.notEqual((raw[8] as unknown[][])[0]![6], back.trains[0]!.trail);
});

test("the checkpoint refuses a world with any field out of its bounds, and never returns part of one", () => {
  const raw = encodeWorld(busy());
  const TRAINS = 8,
    CARTS = 9,
    FXS = 10;
  const bad: [string, number[], unknown][] = [
    ["a seed past 32 bits", [0], 2 ** 33],
    ["a round length no setting makes", [1], 1234],
    ["an unknown phase", [3], "overtime"],
    ["a phase the clock disagrees with", [3], "countdown"],
    ["a train off the floor", [TRAINS, 0, 2], BOUNDS.right + 1],
    ["a heading past a full turn", [TRAINS, 0, 4], 1024],
    ["an unknown cargo kind", [TRAINS, 0, 5], [T.CARGO_KINDS]],
    [
      "a train past its length",
      [TRAINS, 0, 5],
      Array(T.MAX_WAGONS + 1).fill(0),
    ],
    ["a short trail", [TRAINS, 0, 6], [1, 2]],
    ["a crumb off the floor", [TRAINS, 0, 6, 0], -5],
    ["an odometer past a crumb", [TRAINS, 0, 7], T.CRUMB],
    ["control bits that are not steering", [TRAINS, 0, 8], 4],
    ["a guard longer than a cut gives", [TRAINS, 0, 9], T.CUT_GUARD + 1],
    ["a fractional score", [TRAINS, 0, 11], 1.5],
    ["a train in no seat", [TRAINS, 0, 1], T.CAPACITY],
    ["a cart cooling longer than a cut gives", [CARTS, 0, 6], T.CUT_COOL + 1],
    ["a cart id from the future", [CARTS, 0, 0], 2 ** 31],
    ["an effect from the future", [FXS, 0, 1], 10 ** 7],
    ["an unknown effect", [FXS, 0, 2], 99],
  ];
  for (const [what, path, value] of bad)
    assert.equal(decodeWorld(tamper(raw, path, value)), undefined, what);
  const trains = raw[TRAINS] as unknown[][];
  assert.equal(
    decodeWorld(
      tamper(raw, [TRAINS], [trains[1], trains[0], ...trains.slice(2)]),
    ),
    undefined,
    "trains out of slot order",
  );
  assert.equal(
    decodeWorld(tamper(raw, [TRAINS, 1, 0], trains[0]![0])),
    undefined,
    "two trains with one id",
  );
  const carts = raw[CARTS] as unknown[][];
  if (carts.length > 1)
    assert.equal(
      decodeWorld(tamper(raw, [CARTS, 1, 0], carts[0]![0])),
      undefined,
      "two carts with one id",
    );
  assert.equal(
    decodeWorld(tamper(raw, [CARTS], Array(T.MAX_LOOSE + 1).fill(carts[0]))),
    undefined,
    "more carts than the depot holds",
  );
  assert.equal(decodeWorld([...raw, 1]), undefined, "an extra field");
  assert.equal(decodeWorld(raw.slice(0, -1)), undefined, "a missing field");
  assert.equal(decodeWorld(null), undefined);
  assert.equal(decodeWorld({}), undefined);
});

test("the checkpoint refuses a world stepped on past the end of its outro", () => {
  const world = createWorld(5, [{ id: "a", slot: 0 }], { seconds: 60 });
  while (world.phase !== "outro") stepWorld(world, new Map());
  for (let i = 0; i < T.OUTRO_STEPS; i++) stepWorld(world, new Map());
  assert.ok(decodeWorld(encodeWorld(world)), "the end of the outro");
  const raw = encodeWorld(world);
  raw[2] = world.phaseAt + T.OUTRO_STEPS + T.STEPS_PER_TICK + 1;
  assert.equal(decodeWorld(raw), undefined);
});
