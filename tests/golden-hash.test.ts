import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULES } from "../src/shared/apply-tick.js";
import { PICKUP_TYPES } from "../src/shared/game.js";
import { isEntry } from "../src/shared/input-log.js";
import {
  coverageObserver,
  emptyCoverage,
  isObstacleMap,
  replayHashes,
  type Recording,
} from "./fixtures/replay-log.js";

test("the input-only mechanic recording keeps every tick on the pinned rules", () => {
  const recording: Recording = JSON.parse(
    readFileSync(
      new URL("./fixtures/mechanics-recording.json", import.meta.url),
      "utf8",
    ),
  );
  const golden: { rules: string; hashes: string[] } = JSON.parse(
    readFileSync(
      new URL("./fixtures/golden-hashes.json", import.meta.url),
      "utf8",
    ),
  );
  for (const entries of Object.values(recording.entries))
    for (const entry of entries)
      assert.ok(isEntry(entry), "fixture contains only valid wire entries");
  const coverage = emptyCoverage();
  const observeCoverage = coverageObserver(coverage);
  let fiveRiderTicks = 0;
  const hashes = replayHashes(recording, (state) => {
    if (state.game.phase === "playing") {
      assert.equal(state.game.players.size, 5);
      assert.equal(state.bots.size, 3);
      assert.equal(state.folds.size, 2);
      fiveRiderTicks++;
    }
    return observeCoverage(state);
  });
  assert.ok(fiveRiderTicks > 0);
  assert.deepEqual(
    [...coverage.collected].sort(),
    [...PICKUP_TYPES].sort(),
    "every pickup must actually be collected",
  );
  assert.ok(
    coverage.portalTransits > 0,
    "a rider crosses a portal with exit grace",
  );
  assert.ok(
    coverage.shieldAbsorbs > 0,
    "a shield absorbs a hazard while its rider survives",
  );
  assert.ok(
    coverage.maps.some(isObstacleMap),
    "a round is played on an obstacle map",
  );
  assert.ok(
    coverage.obstaclesBlasted > 0,
    "a blast clears an obstacle away on the tick it opens",
  );
  assert.ok(
    coverage.sceneryCrashes > 0,
    "a rider crashes into scenery and dies against it",
  );
  assert.ok(
    coverage.maps.includes("wrap"),
    "a round is played on the wrap map",
  );
  assert.ok(
    coverage.edgeCrossings > 0,
    "a living rider is carried through an open edge without a portal",
  );
  assert.ok(
    coverage.edgeBlasts > 0,
    "a blast opens over an open edge and stands on both sides of it",
  );
  assert.equal(
    RULES,
    golden.rules,
    "bump RULES and update the golden together for intended simulation changes",
  );
  assert.equal(hashes.length, golden.hashes.length);
  const mismatch = hashes.findIndex(
    (hash, index) => hash !== golden.hashes[index],
  );
  assert.equal(
    mismatch,
    -1,
    `state diverged at tick ${mismatch + 1}; preserve the golden for refactors, or bump RULES and update the golden for intended changes`,
  );
});
