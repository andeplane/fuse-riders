import test from "node:test";
import assert from "node:assert/strict";
import {
  fuseVolleyRegistration,
  parseFuseVolleyStats,
  validFuseVolleyField,
  type FuseVolleyStats,
} from "../src/platform.js";

const player = (overrides: Partial<FuseVolleyStats> = {}): FuseVolleyStats => ({
  playerId: "a".repeat(24),
  name: "Ada",
  slot: 0,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 11,
  matchPlacement: 1,
  earlyExits: 0,
  points: 11,
  hits: 40,
  ...overrides,
});
const loser = (overrides: Partial<FuseVolleyStats> = {}) =>
  player({
    playerId: "bot:1",
    name: "Jelly",
    slot: 1,
    roundWins: 0,
    matchPlacement: 2,
    matchScoreUnits: 7,
    points: 7,
    hits: 30,
    ...overrides,
  });

test("a player's stats are accepted only whole, known and within one match", () => {
  assert.deepEqual(parseFuseVolleyStats(player(), 1), player());
  assert.equal(parseFuseVolleyStats(player(), 2), undefined, "one round only");
  const bad: Partial<FuseVolleyStats>[] = [
    { playerId: "nobody" },
    { name: " Ada" },
    { slot: 2 },
    { hits: 20_001 },
    { points: 41, matchScoreUnits: 41 },
    { points: 10 }, // points must be the board
    { matchScoreUnits: 9, points: 9 }, // a winner short of 11
    { matchPlacement: 2 },
    { roundsPlayed: 0 },
  ];
  for (const change of bad)
    assert.equal(
      parseFuseVolleyStats(player(change), 1),
      undefined,
      JSON.stringify(change),
    );
  assert.equal(
    parseFuseVolleyStats({ ...player(), extra: 1 }, 1),
    undefined,
    "an unknown key",
  );
});

test("the field is two sides with one winner, ahead by two or at the cap", () => {
  assert.ok(validFuseVolleyField([player(), loser()]));
  assert.ok(
    validFuseVolleyField([
      player({ matchScoreUnits: 40, points: 40 }),
      loser({ matchScoreUnits: 39, points: 39 }),
    ]),
  );
  assert.ok(
    !validFuseVolleyField([
      player(),
      loser({ matchScoreUnits: 10, points: 10 }),
    ]),
  );
  assert.ok(!validFuseVolleyField([player(), loser({ slot: 0 })]));
  assert.ok(!validFuseVolleyField([player(), loser({ roundWins: 1 })]));
  assert.ok(!validFuseVolleyField([player()]));
});

test("a confirmed match adds to an account's totals, which are read back strictly", () => {
  const standing = fuseVolleyRegistration.emptyTotals();
  fuseVolleyRegistration.addTotals(
    standing,
    fuseVolleyRegistration.credit(player(), [player(), loser()]),
  );
  fuseVolleyRegistration.addTotals(
    standing,
    fuseVolleyRegistration.credit(loser(), [player(), loser()]),
  );
  assert.deepEqual(standing.totals, {
    matches: 2,
    wins: 1,
    points: 18,
    hits: 70,
  });
  assert.deepEqual(
    fuseVolleyRegistration.parseTotals({ totals: standing.totals }),
    standing,
  );
  assert.deepEqual(
    fuseVolleyRegistration.parseTotals({}),
    fuseVolleyRegistration.emptyTotals(),
  );
  assert.equal(
    fuseVolleyRegistration.parseTotals({ totals: { matches: -1 } }),
    undefined,
  );
  assert.ok(fuseVolleyRegistration.isBot("bot:3"));
});
