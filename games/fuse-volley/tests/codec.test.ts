import test from "node:test";
import assert from "node:assert/strict";
import {
  botInput,
  decodeWorld,
  encodeWorld,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { fresh } from "./fixtures/world.js";

/** Plays two levels of bot against each other for `ticks` log ticks. */
function play(world: World, ticks: number): void {
  for (let t = 0; t < ticks && world.phase !== "over"; t++) {
    const inputs: [number, number] = [
      botInput(world, 0, 2),
      botInput(world, 1, 0),
    ];
    for (let i = 0; i < 6; i++) stepWorld(world, inputs);
  }
}

test("a world round-trips through its checkpoint fields at every phase, and the copy plays on identically", () => {
  const world = fresh("classic", 77);
  const seen = new Set<string>();
  for (let round = 0; round < 60; round++) {
    play(world, 37);
    seen.add(world.phase);
    const copy = decodeWorld(structuredClone(encodeWorld(world)));
    assert.ok(copy, `decodes in ${world.phase}`);
    assert.deepEqual(copy, world);
    const a = structuredClone(world);
    play(a, 50);
    play(copy, 50);
    assert.deepEqual(copy, a);
  }
  assert.ok(seen.has("serve") && seen.has("rally") && seen.has("dead"));
});

test("a finished match decodes", () => {
  const world = fresh("rally", 5);
  play(world, 40_000);
  assert.equal(world.phase, "over");
  assert.deepEqual(decodeWorld(encodeWorld(world)), world);
});

test("every out-of-range or inconsistent field is refused", () => {
  const world = fresh("rally", 9);
  play(world, 200);
  const good = encodeWorld(world);
  const tweak = (path: number[], value: unknown) => {
    const raw = structuredClone(good) as unknown[];
    let at: unknown[] = raw;
    for (const index of path.slice(0, -1)) at = at[index] as unknown[];
    at[path.at(-1)!] = value;
    return decodeWorld(raw);
  };
  assert.ok(decodeWorld(good));
  const bad: [number[], unknown][] = [
    [[0], 2], // version
    [[1], 0], // seed
    [[2], -1], // step
    [[3], 9], // phase
    [[5], 0], // rng
    [[6], 2], // scoring
    [[7], 2], // server
    [[8], 3], // lastFault
    [[12], 41], // score past the cap
    [[12], -0], // negative zero
    [[14], 65536], // counter
    [[18, 0], 0], // ball inside the left wall
    [[18, 1], 0], // ball below the sand
    [[18, 2], 5000], // ball speed
    [[18, 6], 2], // live flag
    [[19, 0], 7], // a blob id
    [[19, 1], 361], // left blob past the net
    [[20, 1], 439], // right blob past the net
    [[19, 2], 25599], // feet below the sand
    [[19, 5], 5], // squash frame
    [[19, 7], 4], // four touches standing
    [[19, 11], 20001], // hits
  ];
  for (const [path, value] of bad)
    assert.equal(tweak(path, value), undefined, `refuses ${path} = ${value}`);
  assert.equal(decodeWorld(good.slice(1)), undefined);
  assert.equal(decodeWorld(null), undefined);
  // The same id on both sides.
  const twins = structuredClone(good) as unknown[];
  (twins[20] as unknown[])[0] = (twins[19] as unknown[])[0];
  assert.equal(decodeWorld(twins), undefined);
});

test("cross-field checks: a serve hovers still, a winner is decided, a grounded blob stands", () => {
  const serving = fresh("rally", 3);
  const encode = () => structuredClone(encodeWorld(serving)) as unknown[];
  let raw = encode();
  (raw[18] as unknown[])[2] = 5; // a hovering serve that moves
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  raw[9] = 0; // a winner at 0–0
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  raw[12] = 11; // decided but no winner
  raw[8] = 1;
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  raw[12] = 3; // a score before any rally
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  (raw[19] as unknown[])[3] = 10; // standing with speed
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  raw[11] = serving.step + 1; // a touch in the future
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  raw[3] = 3; // over without a winner
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  (raw[19] as unknown[])[7] = 2; // touches already used on a fresh serve
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  (raw[20] as unknown[])[9] = 1; // in contact with a hovering serve it never touched
  assert.equal(decodeWorld(raw), undefined);
  raw = encode();
  raw[3] = 2; // a settle that no rally ended
  raw[4] = 10;
  assert.equal(decodeWorld(raw), undefined);
});
