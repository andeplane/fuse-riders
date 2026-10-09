import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  createRound,
  nextRoundConfig,
  recordRoundResult,
} from "../src/engine/index.js";

test("a match is first to N round wins, with a fresh seed per round", () => {
  const match = createMatch({ seed: 77, playerCount: 3, winsToWin: 2 });
  const first = nextRoundConfig(match);
  assert.equal(first.playerCount, 3);
  assert.equal(
    recordRoundResult(match, { winner: 1, reason: "last-standing", tick: 100 }),
    null,
  );
  const second = nextRoundConfig(match);
  assert.notEqual(first.seed, second.seed);
  assert.notEqual(
    createRound(first).terrain.surface[800],
    createRound(second).terrain.surface[800],
  );
  assert.equal(
    recordRoundResult(match, { winner: null, reason: "wipeout", tick: 100 }),
    null,
  );
  assert.equal(
    recordRoundResult(match, { winner: 1, reason: "timeout", tick: 100 }),
    1,
  );
  assert.deepEqual(match.wins, [0, 2, 0]);
  assert.equal(match.history.length, 3);
  assert.throws(() => createMatch({ seed: 1, playerCount: 8 }), RangeError);
});
