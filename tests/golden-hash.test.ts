import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULES } from "../src/shared/apply-tick.js";
import { PICKUP_TYPES } from "../src/shared/game.js";
import { isEntry } from "../src/shared/input-log.js";
import { replayHashes, type Recording } from "./fixtures/replay-log.js";
import {
  coverageObserver,
  emptyCoverage,
  isObstacleMap,
  REQUIREMENTS,
} from "./fixtures/replay-coverage.js";

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
  assert.deepEqual(
    Object.keys(recording).sort(),
    ["creator", "entries", "matchId", "ticks"],
    "the fixture is a log of inputs and nothing else",
  );
  for (const entries of Object.values(recording.entries))
    for (const entry of entries)
      assert.ok(isEntry(entry), "fixture contains only valid wire entries");
  const coverage = emptyCoverage();
  const observeCoverage = coverageObserver(coverage);
  let fiveRiderTicks = 0,
    duelTicks = 0;
  const hashes = replayHashes(recording, (state) => {
    if (state.game.phase === "playing") {
      assert.equal(
        state.bots.size + state.folds.size,
        state.game.players.size,
        "every seated rider is a bot or a human stream",
      );
      // The bots are sent home for the duels; with any of them seated the room is full.
      if (state.bots.size) assert.equal(state.game.players.size, 5);
      else assert.equal(state.game.players.size, 2);
      if (
        state.bots.size === 3 &&
        state.folds.size === 2 &&
        state.game.roundParticipants.size === 5
      )
        fiveRiderTicks++;
      if (state.game.roundParticipants.size === 2) duelTicks++;
    }
    return observeCoverage(state);
  });
  assert.ok(
    fiveRiderTicks >= 3000,
    "two humans and three bots ride together for at least 150 seconds of play",
  );
  assert.ok(duelTicks > 0, "the two humans also ride alone");
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
  for (const map of ["desert", "forest", "city", "wrap", "classic", "cross"])
    assert.ok(
      (coverage.maps as string[]).includes(map),
      `a round is played on ${map}`,
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
    coverage.edgeCrossings > 0,
    "a living rider is carried through an open edge without a portal",
  );
  assert.ok(
    coverage.edgeBlasts > 0,
    "a blast opens over an open edge and stands on both sides of it",
  );
  // What the recorder played for, read back from this replay: it stops only once every one of these holds, so a
  // fresh `--record` cannot write a fixture that fails here.
  for (const { key, claim, met } of REQUIREMENTS)
    assert.ok(met(coverage), `${key}: ${claim} (${JSON.stringify(coverage)})`);
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
