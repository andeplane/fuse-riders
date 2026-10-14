import { test } from "node:test";
import assert from "node:assert/strict";
import { hashState } from "fuse-birds-game";
import {
  checkpointJSON,
  initialMatch,
  readCheckpoint,
  readLog,
  runHeadless,
} from "../../../scripts/lib/fuse-birds-headless.js";

test("a recorded complete match replays and resumes through only the public library API", () => {
  const original = initialMatch(123, 2);
  const { record, summary } = runHeadless(original, {
    ticks: 10_000,
    driver: "aimed",
  });
  assert.equal(summary.phase, "over");
  assert.ok(original.terrain.version > 0);
  const log = readLog(JSON.parse(JSON.stringify(record)));
  const resumed = initialMatch(123, 2);
  runHeadless(resumed, { ticks: 60, driver: "idle", log });
  const copy = readCheckpoint(JSON.parse(checkpointJSON(resumed)));
  runHeadless(copy, { ticks: 10_000, driver: "idle", log });
  assert.equal(hashState(copy), hashState(original));
});
test("headless inputs reject corrupt checkpoints and unordered or incompatible logs", () => {
  const s = initialMatch(17, 3),
    raw = JSON.parse(checkpointJSON(s));
  raw.state.players[0].ammo = 4;
  assert.throws(() => readCheckpoint(raw), /hash/);
  assert.throws(() => readLog({ rules: "old", entries: [] }), /envelope/);
  assert.throws(
    () =>
      readLog({
        rules: s.rules,
        entries: [
          { tick: 2, actions: [] },
          { tick: 1, actions: [] },
        ],
      }),
    /unordered/,
  );
  assert.throws(() => runHeadless(s, { ticks: -1, driver: "idle" }), /limit/);
  assert.throws(() => initialMatch(1, 6), /count/);
});
