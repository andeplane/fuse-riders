import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_ATTACK,
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_MASK,
  INPUT_PRESSED,
  INPUT_RIGHT,
  MAX_PLAYERS,
  NEUTRAL,
  QUEEN_EGGS,
  RULES,
  TICK_HZ,
  cloneRound,
  createRound,
  hashRound,
  packInput,
  stepRound,
  unpackInput,
  type Input,
  type Round,
} from "../src/engine/index.js";
import {
  chance,
  hashSeed,
  nextU32,
  randInt,
  randSpread,
} from "../src/engine/rng.js";
import { control } from "./engine-kit.js";

function play(state: Round, steps: number): Round {
  for (let i = 0; i < steps; i += 1) stepRound(state, []);
  return state;
}

/** A person's scripted controls for slot 0: the same every time for the same step. */
function scripted(step: number): Input[] {
  return [
    control({
      left: step % 90 < 30,
      right: step % 90 >= 60,
      down: step % 200 > 190,
      held: step % 7 < 3,
      pressed: step % 7 === 0,
    }),
  ];
}

test("the same seed and inputs give the identical game, step for step", () => {
  const a = createRound({ seed: 42, botLevel: "hard" }),
    b = createRound({ seed: 42, botLevel: "hard" });
  for (let i = 0; i < 12; i += 1) {
    play(a, 100);
    play(b, 100);
    assert.equal(hashRound(a), hashRound(b), `after ${a.step} steps`);
  }
  assert.deepEqual(a, b);
  assert.ok(a.step > 0);
});

test("a person's inputs are part of the game: the same script replays, a different one diverges", () => {
  const humans = [true];
  const a = createRound({ seed: 5, humans }),
    b = createRound({ seed: 5, humans }),
    c = createRound({ seed: 5, humans });
  for (let step = 0; step < 400; step += 1) {
    stepRound(a, scripted(step));
    stepRound(b, scripted(step));
    stepRound(c, []);
  }
  assert.equal(hashRound(a), hashRound(b));
  assert.notEqual(hashRound(a), hashRound(c));
});

test("a copy taken mid-game continues exactly like the original, as a structured clone and through JSON", () => {
  const original = play(createRound({ seed: 9, botLevel: "hard" }), 500);
  const copy = cloneRound(original);
  const parsed: unknown = JSON.parse(JSON.stringify(original));
  const decoded = cloneRound(original);
  assert.deepEqual(parsed, decoded);
  assert.notEqual(copy.units, original.units);
  play(original, 700);
  play(copy, 700);
  assert.equal(hashRound(copy), hashRound(original));
  assert.deepEqual(copy, original);
});

test("different seeds play different games", () => {
  const hashes = new Set(
    [1, 2, 3, 4].map((seed) => hashRound(play(createRound({ seed }), 600))),
  );
  assert.equal(hashes.size, 4);
});

function assertPlain(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return;
  if (typeof value === "number") {
    assert.ok(Number.isSafeInteger(value), `${path} is ${value}`);
    return;
  }
  assert.equal(typeof value, "object", path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlain(item, `${path}[${index}]`));
    return;
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype, path);
  for (const [key, item] of Object.entries(value ?? {}))
    assertPlain(item, `${path}.${key}`);
}

test("the state is plain data and every number in it is an integer, all game long", () => {
  for (const mapId of [1, 2, 3] as const) {
    const state = createRound({ seed: 11 + mapId, mapId, botLevel: "hard" });
    for (let i = 0; i < 20 && !state.winner; i += 1) {
      play(state, 150);
      assertPlain(state, `map ${mapId} step ${state.step}`);
    }
  }
});

test("the hash is 16 hex characters over the state, without the last step's events", () => {
  const state = play(createRound({ seed: 3 }), 50);
  const hash = hashRound(state);
  assert.match(hash, /^[0-9a-f]{16}$/);
  state.events = [{ type: "berryRegrow" }];
  assert.equal(hashRound(state), hash);
  const unit = state.units[4];
  assert.ok(unit);
  unit.x += 1;
  assert.notEqual(hashRound(state), hash);
});

test("an input packs into six bits and back", () => {
  for (let bits = 0; bits <= INPUT_MASK; bits += 1)
    assert.equal(packInput(unpackInput(bits)), bits);
  assert.equal(packInput(NEUTRAL), 0);
  assert.deepEqual(unpackInput(0), NEUTRAL);
  assert.equal(
    packInput(control({ left: true, down: true, pressed: true, attack: true })),
    INPUT_LEFT | INPUT_DOWN | INPUT_PRESSED | INPUT_ATTACK,
  );
  assert.equal(
    INPUT_LEFT |
      INPUT_RIGHT |
      INPUT_DOWN |
      INPUT_HELD |
      INPUT_PRESSED |
      INPUT_ATTACK,
    INPUT_MASK,
  );
  // Bits above the mask are ignored.
  assert.deepEqual(unpackInput(INPUT_MASK + 1), NEUTRAL);
});

test("a new round: six units on their team's side, three eggs each, bots unless told otherwise", () => {
  const state = createRound({ seed: 12.9 });
  assert.equal(state.rules, RULES);
  assert.equal(RULES, "killer-fuse-4");
  assert.equal(TICK_HZ, 60);
  assert.equal(state.seed, 12);
  assert.equal(state.mapId, 1);
  assert.equal(state.botLevel, "medium");
  assert.deepEqual(state.teamLevels, ["medium", "medium"]);
  assert.equal(state.units.length, MAX_PLAYERS);
  assert.deepEqual(
    state.units.map((unit) => unit.kind),
    ["queen", "queen", "worker", "worker", "worker", "worker"],
  );
  assert.deepEqual(state.eggs, [QUEEN_EGGS, QUEEN_EGGS]);
  assert.deepEqual(state.humans, [false, false, false, false, false, false]);
  assert.equal(state.winner, null);
  assert.equal(state.bots.length, MAX_PLAYERS);
  for (const unit of state.units)
    assert.equal(unit.x < 240 * 1024, unit.team === 0, `slot ${unit.slot}`);
  const mixed = createRound({
    seed: 1,
    mapId: 2,
    botLevel: "easy",
    teamLevels: ["hard", "easy"],
    humans: [false, true],
  });
  assert.deepEqual(mixed.teamLevels, ["hard", "easy"]);
  assert.deepEqual(mixed.humans, [false, true, false, false, false, false]);
  assert.equal(mixed.mapId, 2);
});

test("a person's slot does only what its input says, and a missing input is neutral", () => {
  const state = createRound({
    seed: 1,
    humans: [true, true, true, true, true, true],
  });
  play(state, 120);
  for (const unit of state.units) {
    assert.equal(unit.vx, 0);
    assert.ok(unit.ground >= 0);
  }
  const queen = state.units[0];
  assert.ok(queen);
  const from = queen.x;
  for (let i = 0; i < 30; i += 1) stepRound(state, [control({ right: true })]);
  assert.ok(queen.x > from);
});

test("the random stream is integer, seeded and uniform enough", () => {
  const a = { rng: hashSeed(1) },
    b = { rng: hashSeed(1) };
  assert.equal(nextU32(a), nextU32(b));
  assert.notEqual(hashSeed(1), hashSeed(2));
  assert.notEqual(hashSeed(1, 1), hashSeed(1, 2));
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i += 1) {
    const value = randInt(a, 6);
    assert.ok(Number.isInteger(value) && value >= 0 && value < 6);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  for (const count of counts) assert.ok(count > 850 && count < 1150);
  assert.equal(randInt(a, 0), 0);
  let low = 0,
    high = 0,
    yes = 0;
  for (let i = 0; i < 2000; i += 1) {
    const value = randSpread(a, 3);
    low = Math.min(low, value);
    high = Math.max(high, value);
    if (chance(a, 25)) yes += 1;
  }
  assert.equal(low, -3);
  assert.equal(high, 3);
  assert.ok(yes > 400 && yes < 600);
  assert.equal(chance(a, 0), false);
  assert.equal(chance(a, 100), true);
});
