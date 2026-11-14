import test from "node:test";
import assert from "node:assert/strict";
import {
  botInput,
  cloneWorld,
  decodeWorld,
  encodeWorld,
  planInput,
  riderId,
  stepWorld,
  type BotLevel,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { fresh, steps, ticks } from "./fixtures/world.js";

const bots = (world: World, slot: number) =>
  botInput(world, slot, (slot % 3) as BotLevel);

/** A match of four bots at some point of its play. */
function midMatch(tickCount: number, seed = 77): World {
  const world = fresh({ target: 2, seconds: 20 }, seed, ["a", "b", "c", "d"]);
  ticks(world, tickCount, bots);
  return world;
}

test("a world round-trips through its checkpoint fields at every phase, and the copy plays on identically", () => {
  const world = fresh({ target: 2, seconds: 20, hits: 2 }, 31, [
    "a",
    "b",
    "c",
    "d",
  ]);
  const phases = new Set<string>();
  for (let tick = 0; tick < 4000 && world.phase !== "over"; tick++) {
    const bits = world.riders.map((_, slot) => bots(world, slot));
    for (let i = 0; i < T.STEPS_PER_TICK; i++) {
      stepWorld(world, bits);
      if (world.step % 7 !== 0) continue;
      phases.add(world.phase);
      const fields = encodeWorld(world);
      const decoded = decodeWorld(JSON.parse(JSON.stringify(fields)));
      assert.deepEqual(decoded, world, `step ${world.step} (${world.phase})`);
    }
  }
  assert.deepEqual([...phases].sort(), ["break", "play", "ready"]);
  assert.equal(world.phase, "over");
  const done = decodeWorld(encodeWorld(world));
  assert.deepEqual(done, world, "a finished match decodes");
  // A decoded copy plays on exactly as the original does.
  const original = midMatch(300),
    copy = decodeWorld(encodeWorld(original))!;
  ticks(original, 200, bots);
  ticks(copy, 200, bots);
  assert.deepEqual(copy, original);
});

/** The fields with one of them replaced; `rider`/`surge` index into those tuples. */
function tampered(
  world: World,
  change: (fields: unknown[]) => void,
): World | undefined {
  const fields = JSON.parse(JSON.stringify(encodeWorld(world))) as unknown[];
  change(fields);
  return decodeWorld(fields);
}
const RIDER = 18,
  SURGES = 17;

test("every out-of-range or malformed field is refused, and the world given is left alone", () => {
  const world = midMatch(260);
  assert.equal(world.phase, "play");
  assert.ok(world.surges.length > 0);
  const before = JSON.stringify(world);
  assert.ok(decodeWorld(encodeWorld(world)));
  for (const raw of [null, undefined, 7, "world", {}, [], [1, 2, 3]])
    assert.equal(decodeWorld(raw), undefined);
  const head: [number, unknown][] = [
    [0, 2],
    [1, 0],
    [1, 2 ** 32],
    [2, -1],
    [2, 1.5],
    [3, 4],
    [3, "play"],
    [4, 1],
    [5, 0],
    [5, T.MAX_ROUNDS + 1],
    [6, -1],
    [6, 20 * T.STEPS_PER_SECOND + 1],
    [7, [3, 20, 1, 2]],
    [7, [0, 20, 1, 2, 1]],
    [7, [3, 5, 1, 2, 1]],
    [7, [3, 20, 3, 2, 1]],
    [7, [3, 20, 1, 6, 1]],
    [7, [3, 20, 1, 2, 2]],
    [7, "rules"],
    [8, 0],
    [9, 257],
    [10, 0],
    [11, 2],
    [12, T.MAX_RUN + 1],
    [13, 16],
    [14, 4],
    [15, 16],
    [16, T.COUNTER],
    [16, -0],
    [SURGES, "none"],
    [
      SURGES,
      Array.from({ length: T.MAX_SURGES + 1 }, () => [1, 0, 0, 5, 0, 0]),
    ],
  ];
  for (const [index, value] of head)
    assert.equal(
      tampered(world, (fields) => (fields[index] = value)),
      undefined,
      `head field ${index} = ${JSON.stringify(value)}`,
    );
  const rider: [number, unknown][] = [
    [0, ""],
    [0, "x".repeat(65)],
    [0, 5],
    [1, T.START_X + 1],
    [1, T.OUT_X - 1],
    [2, T.MAX_Y + 1],
    [2, -T.FALL_DEPTH - 1],
    [3, T.JUMP_V + 1],
    [3, -T.MAX_FALL_V - 1],
    [4, 2],
    [5, true],
    [6, T.JUMP_BUFFER + 1],
    [7, 4],
    [8, 2],
    [9, T.REEL_STEPS + 1],
    [10, T.GRACE_STEPS + 1],
    [11, T.STREAK_FOR_STEP + 1],
    [12, 3],
    [13, T.MOST_DODGES + 1],
    [14, T.MOST_TAKEN + 1],
  ];
  for (const [index, value] of rider)
    assert.equal(
      tampered(
        world,
        (fields) => ((fields[RIDER] as unknown[])[index] = value),
      ),
      undefined,
      `rider field ${index} = ${JSON.stringify(value)}`,
    );
  const surge: [number, unknown][] = [
    [0, 0],
    [1, 2],
    [2, 2],
    [3, T.EXIT_X],
    [3, T.SPAWN_X + 1],
    [4, 16],
    [5, 16],
  ];
  for (const [index, value] of surge)
    assert.equal(
      tampered(
        world,
        (fields) =>
          (((fields[SURGES] as unknown[])[0] as unknown[])[index] = value),
      ),
      undefined,
      `surge field ${index} = ${JSON.stringify(value)}`,
    );
  // Tuples of the wrong length, a rider too few and a rider too many.
  assert.equal(
    tampered(world, (f) => (f[RIDER] as unknown[]).push(0)),
    undefined,
  );
  assert.equal(
    tampered(world, (f) => ((f[SURGES] as unknown[])[0] as unknown[]).pop()),
    undefined,
  );
  assert.equal(
    tampered(world, (f) => f.splice(RIDER + 1)),
    undefined,
  );
  assert.equal(
    tampered(world, (f) => f.push(f[RIDER], f[RIDER])),
    undefined,
  );
  assert.equal(
    JSON.stringify(world),
    before,
    "nothing above touched the world",
  );
  assert.ok(riderId("a") && !riderId("") && !riderId(3));
});

test("cross-field checks: what the simulation never produces is not a world", () => {
  const playing = midMatch(260);
  const rider = (change: (rider: unknown[]) => void) =>
    tampered(playing, (fields) => change(fields[RIDER] as unknown[]));
  // Two riders with one id.
  assert.equal(
    tampered(playing, (f) => ((f[RIDER + 1] as unknown[])[0] = "a")),
    undefined,
  );
  // Out without the hits, and the hits without being out.
  assert.equal(
    rider((r) => (r[8] = 1)),
    undefined,
  );
  assert.equal(
    rider((r) => (r[7] = 3)),
    undefined,
  );
  // On the deck: never past the last foothold, never under the surface, never ducking in the air.
  assert.equal(
    rider((r) => (r[1] = T.LAST_X - 1)),
    undefined,
  );
  assert.equal(
    rider((r) => (r[2] = -1)),
    undefined,
  );
  assert.equal(
    rider((r) => ((r[4] = 1), (r[2] = 500))),
    undefined,
  );
  assert.equal(
    rider((r) => ((r[4] = 1), (r[2] = 0), (r[3] = 50))),
    undefined,
  );
  // Reeling and its afterglow are one after the other.
  assert.equal(
    rider((r) => ((r[9] = 5), (r[10] = 5))),
    undefined,
  );
  // A rider that is out is done ducking and reeling, and is under the deck only past its edge.
  const gone = (change: (rider: unknown[]) => void) =>
    rider((r) => {
      r[7] = 3;
      r[8] = 1;
      r[4] = 0;
      r[9] = 0;
      r[10] = 0;
      change(r);
    });
  assert.ok(
    gone(() => {}),
    "a rider knocked out mid-round is a world",
  );
  assert.equal(
    gone((r) => (r[9] = 3)),
    undefined,
  );
  assert.equal(
    gone((r) => (r[10] = 3)),
    undefined,
  );
  assert.equal(
    gone((r) => ((r[2] = 0), (r[3] = 0), (r[4] = 1))),
    undefined,
  );
  assert.equal(
    gone((r) => ((r[1] = T.EDGE_X + 5), (r[2] = -10))),
    undefined,
  );
  assert.ok(gone((r) => ((r[1] = T.OUT_X), (r[2] = -10))));
  // Surges: struck only who it is settled for, flips only before the gate, in the order they were sent, ids once.
  const surge = (change: (surges: unknown[][]) => void) =>
    tampered(playing, (fields) => change(fields[SURGES] as unknown[][]));
  assert.equal(
    surge((s) => ((s[0]![4] = 0), (s[0]![5] = 1))),
    undefined,
  );
  assert.equal(
    surge((s) => ((s[0]![2] = 1), (s[0]![3] = T.GATE_X))),
    undefined,
  );
  assert.equal(
    surge((s) => s.push([999, 0, 0, s[0]![3], 0, 0])),
    undefined,
  );
  assert.equal(
    surge((s) => s.push([s[0]![0], 0, 0, T.SPAWN_X, 0, 0])),
    undefined,
  );
  // The phases: a countdown has played nothing, a round has two riders up and time left, and only breaks rest.
  const ready = fresh({}, 5);
  steps(ready, 10);
  assert.ok(decodeWorld(encodeWorld(ready)));
  assert.equal(
    tampered(ready, (f) => (f[6] = 5)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[4] = 0)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[4] = T.READY_STEPS + 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[SURGES] = [[1, 0, 0, 5000, 0, 0]])),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => {
      const r = f[RIDER] as unknown[];
      r[7] = 3;
      r[8] = 1;
    }),
    undefined,
    "nobody is out during a countdown",
  );
  assert.equal(
    tampered(playing, (f) => (f[6] = 20 * T.STEPS_PER_SECOND)),
    undefined,
  );
  assert.equal(
    tampered(playing, (f) => {
      for (const index of [RIDER, RIDER + 1, RIDER + 2]) {
        const r = f[index] as unknown[];
        Object.assign(r, { 4: 0, 7: 3, 8: 1, 9: 0, 10: 0 });
      }
    }),
    undefined,
    "a round with one rider up has ended",
  );
  // Wins, winners and reasons agree with the phase.
  assert.equal(
    tampered(playing, (f) => ((f[RIDER] as unknown[])[12] = 2)),
    undefined,
  );
  assert.equal(
    tampered(playing, (f) => (f[15] = 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[14] = 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[13] = 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[5] = 2)),
    undefined,
  );
  const over = cloneWorld(midMatch(6000));
  assert.equal(over.phase, "over");
  assert.ok(decodeWorld(encodeWorld(over)));
  assert.equal(
    tampered(over, (f) => (f[15] = 0)),
    undefined,
  );
  assert.equal(
    tampered(over, (f) => (f[15] = 15)),
    undefined,
  );
  assert.equal(
    tampered(over, (f) => {
      for (const index of [RIDER, RIDER + 1, RIDER + 2, RIDER + 3])
        (f[index] as unknown[])[12] = 1;
      f[15] = 15;
    }),
    undefined,
    "nobody reached the target",
  );
});
