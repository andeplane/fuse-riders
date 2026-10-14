import test from "node:test";
import assert from "node:assert/strict";
import { InputRecorder } from "../src/input-recorder.js";
import { StreamLog } from "../src/stream.js";
import { ADD, counterGame } from "./fixtures/counter-game.js";

test("a next-tick input stays ahead of eager folds while grouped entries remain atomic", () => {
  const log = new StreamLog(counterGame, 1);
  let clock = 0,
    world = 1;
  const recorder = new InputRecorder(
    () => log,
    () => clock,
    () => world,
  );
  assert.equal(recorder.append([ADD, 1]), 2);
  assert.equal(recorder.append([ADD, 2]), 2, "same-tick entries stay grouped");
  world = 2;
  assert.equal(
    recorder.append([ADD, 3]),
    3,
    "an eager fold cannot swallow the next input",
  );
  clock = 9.2;
  assert.equal(recorder.next(), 10);
  clock = 3;
  assert.equal(
    recorder.next(),
    10,
    "clock corrections never move a stamp backwards",
  );
});
