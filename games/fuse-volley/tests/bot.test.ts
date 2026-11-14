import test from "node:test";
import assert from "node:assert/strict";
import {
  botInput,
  encodeWorld,
  mirrored,
  stepWorld,
  type BotLevel,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { fresh } from "./fixtures/world.js";

type Pilot = BotLevel | "idle";
const answer = (world: World, side: 0 | 1, pilot: Pilot) =>
  pilot === "idle" ? 0 : botInput(world, side, pilot);

/** A whole match, bots answering once per six-step log tick; at most 20 minutes. */
function match(left: Pilot, right: Pilot, seed: number): World {
  const world = fresh("rally", seed);
  for (let t = 0; t < 24_000 && world.phase !== "over"; t++) {
    const inputs: [number, number] = [
      answer(world, 0, left),
      answer(world, 1, right),
    ];
    for (let i = 0; i < 6; i++) stepWorld(world, inputs);
  }
  return world;
}

test("every level beats a blob that stands still, from either side", () => {
  for (const level of [0, 1, 2] as const) {
    assert.equal(match(level, "idle", 11).winner, 0, `level ${level} left`);
    assert.equal(match("idle", level, 12).winner, 1, `level ${level} right`);
  }
});

test("hard beats easy over seeded matches", () => {
  let wins = 0;
  for (let seed = 1; seed <= 6; seed++)
    if (match(2, 0, seed * 7919).winner === 0) wins++;
  assert.ok(wins >= 5, `hard won ${wins} of 6`);
});

test("the court is fair: a mirrored world plays out mirrored", () => {
  const a = fresh("rally", 5),
    b = fresh("rally", 5);
  b.server = a.server === 0 ? 1 : 0;
  b.ball.x = T.COURT_W * T.BU - a.ball.x;
  b.ball.prevX = b.ball.x;
  b.blobs[0].id = a.blobs[1].id;
  b.blobs[1].id = a.blobs[0].id;
  for (let t = 0; t < 3000; t++) {
    const left = botInput(a, 0, 2),
      right = botInput(a, 1, 2);
    assert.equal(botInput(b, 0, 2), mirrored(right), `tick ${t}`);
    assert.equal(botInput(b, 1, 2), mirrored(left), `tick ${t}`);
    for (let i = 0; i < 6; i++) {
      stepWorld(a, [left, right]);
      stepWorld(b, [mirrored(right), mirrored(left)]);
    }
    assert.equal(a.ball.x, T.COURT_W * T.BU - b.ball.x);
    assert.equal(a.ball.y, b.ball.y);
    assert.equal(a.blobs[0].x, T.COURT_W - b.blobs[1].x);
    assert.deepEqual(a.score, [b.score[1], b.score[0]]);
  }
  assert.ok(a.score[0] + a.score[1] > 0, "and points were played");
});

test("asking the bot never changes the world", () => {
  const world = fresh("rally", 21);
  for (let t = 0; t < 600; t++) {
    const before = JSON.stringify(encodeWorld(world));
    const inputs: [number, number] = [
      botInput(world, 0, 1),
      botInput(world, 1, 0),
    ];
    assert.equal(JSON.stringify(encodeWorld(world)), before);
    for (let i = 0; i < 6; i++) stepWorld(world, inputs);
  }
});
