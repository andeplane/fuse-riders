import test from "node:test";
import assert from "node:assert/strict";
import {
  elastoFuseRegistration,
  emptyElastoFuseTotals,
  parseElastoFuseStats,
  validElastoFuseField,
  type ElastoFuseStats,
} from "../src/platform.js";
import { MOST_POINTS } from "../src/basics.js";

const rider = (
  slot: number,
  placement: number,
  points: number,
  finishes: number,
): ElastoFuseStats => ({
  playerId: `${slot}`.repeat(24),
  name: `Rider ${slot}`,
  slot,
  roundsPlayed: 1,
  roundWins: placement === 1 ? 1 : 0,
  matchScoreUnits: points,
  matchPlacement: placement,
  earlyExits: 0,
  points,
  finishes,
  deaths: 3,
});

test("a rider's stats are checked field by field and rebuilt", () => {
  const good = rider(0, 1, 17, 2);
  assert.deepEqual(parseElastoFuseStats(good, 1), good);
  assert.deepEqual(parseElastoFuseStats({ ...good, playerId: "bot:1" }, 1), {
    ...good,
    playerId: "bot:1",
  });
  for (const bad of [
    null,
    { ...good, extra: 1 },
    { ...good, playerId: "nobody" },
    { ...good, name: " padded " },
    { ...good, points: MOST_POINTS + 1, matchScoreUnits: MOST_POINTS + 1 },
    { ...good, points: 21 },
    { ...good, points: 30, matchScoreUnits: 30 },
    { ...good, roundWins: 0 },
    { ...good, matchPlacement: 0 },
    { ...good, deaths: -1 },
    { ...good, slot: 5 },
  ])
    assert.equal(parseElastoFuseStats(bad, 1), undefined, JSON.stringify(bad));
  assert.equal(parseElastoFuseStats(good, 2), undefined, "one round only");
});

test("a field is one to five riders in distinct seats and places, points never rising down the places", () => {
  assert.ok(validElastoFuseField([rider(0, 1, 0, 0)]), "alone and never home");
  assert.ok(validElastoFuseField([rider(0, 2, 7, 1), rider(1, 1, 10, 1)]));
  assert.ok(!validElastoFuseField([]));
  assert.ok(!validElastoFuseField([rider(0, 1, 7, 1), rider(1, 2, 10, 1)]));
  assert.ok(!validElastoFuseField([rider(0, 1, 7, 1), rider(0, 2, 5, 1)]));
  assert.ok(!validElastoFuseField([rider(0, 1, 7, 1), rider(1, 1, 7, 1)]));
  assert.ok(!validElastoFuseField([rider(0, 1, 7, 1), rider(2, 2, 5, 1)]));
});

test("a confirmed match adds to an account's totals, and stored totals are read back strictly", () => {
  const standing = elastoFuseRegistration.emptyTotals();
  elastoFuseRegistration.addTotals(
    standing,
    elastoFuseRegistration.credit(rider(0, 1, 17, 2)),
  );
  elastoFuseRegistration.addTotals(
    standing,
    elastoFuseRegistration.credit(rider(1, 2, 5, 1)),
  );
  assert.deepEqual(standing.totals, {
    matches: 2,
    wins: 1,
    points: 22,
    finishes: 3,
    deaths: 6,
  });
  assert.deepEqual(elastoFuseRegistration.parseTotals({}), {
    totals: emptyElastoFuseTotals(),
  });
  assert.deepEqual(
    elastoFuseRegistration.parseTotals({ totals: standing.totals }),
    standing,
  );
  assert.equal(
    elastoFuseRegistration.parseTotals({ totals: { matches: -1 } }),
    undefined,
  );
  assert.ok(elastoFuseRegistration.isBot("bot:3"));
});
