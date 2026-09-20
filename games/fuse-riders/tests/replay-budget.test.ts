import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strideFrom, strideNote } from "./fixtures/replay-budget.js";
import { replayHashes, type Recording } from "./fixtures/replay-log.js";

test("an unset or empty replay stride checks every tick", () => {
  assert.equal(strideFrom(undefined), 1);
  assert.equal(strideFrom(""), 1);
  assert.equal(strideFrom("1"), 1);
  assert.equal(strideFrom("10"), 10);
});

test("a stride the replays would misread is rejected, not rounded", () => {
  // Silently folding these to 1 would make a run claim more than it checked; to 0 or NaN, less.
  for (const bad of ["0", "-1", "1.5", "ten", "1e3", " ", "Infinity", "0x10"])
    assert.throws(
      () => strideFrom(bad),
      /must be a whole number of ticks/,
      `stride '${bad}'`,
    );
});

test("the note says which budget ran, so a sampled run never reads as a full one", () => {
  assert.match(strideNote(1, 100), /every tick of 100/);
  const sampled = strideNote(10, 100);
  assert.match(sampled, /1 tick in 10 of 100/);
  assert.match(sampled, /main runs every tick/);
});

test("a stride thins the hashes and folds every tick all the same", () => {
  const recording: Recording = JSON.parse(
    readFileSync(
      new URL("./fixtures/mechanics-recording.json", import.meta.url),
      "utf8",
    ),
  );
  // A slice of the pinned recording: this is about the stride's bookkeeping, not about the engine.
  const short: Recording = { ...recording, ticks: 25 };
  const every = replayHashes(short);
  const tenth = replayHashes(short, undefined, 10);

  assert.equal(every.length, short.ticks, "one entry per tick, always");
  assert.equal(tenth.length, short.ticks);
  assert.ok(
    every.every((hash) => hash !== ""),
    "stride 1 hashes every tick",
  );
  // Ticks 10 and 20 by the stride, and 25 because the last tick is always checked.
  assert.deepEqual(
    tenth.flatMap((hash, index) => (hash === "" ? [] : [index + 1])),
    [10, 20, 25],
  );
  // The hashes it did keep are the same ones: the fold ran identically, only the hashing was skipped.
  for (const tick of [10, 20, 25])
    assert.equal(
      tenth[tick - 1],
      every[tick - 1],
      `tick ${tick} folded to a different state at a stride`,
    );
});
