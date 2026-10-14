import test from "node:test";
import assert from "node:assert/strict";
import { MAX_NET_WORTH, MAX_WEEKS } from "../src/game/index.js";
import {
  TOTAL_KEYS,
  emptyFuseLaneTotals,
  fuseLaneRegistration,
  parseFuseLaneStats,
  type FuseLaneStats,
  type FuseLaneTotalsRecord,
} from "../src/platform.js";

/** Ada won a 3-round match (rounds bound the round counters) in week 12. */
const ADA: FuseLaneStats = {
  playerId: "a".repeat(24),
  name: "Ada",
  slot: 0,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 100,
  matchPlacement: 1,
  earlyExits: 0,
  weeks: 12,
  netWorth: 5000,
  degrees: 2,
  shifts: 40,
};

test("a reported player is rebuilt in one key order; a bot id is a player id too", () => {
  const shuffled = Object.fromEntries(Object.entries(ADA).reverse());
  const parsed = parseFuseLaneStats(shuffled, 3)!;
  assert.deepEqual(parsed, ADA);
  assert.deepEqual(Object.keys(parsed), Object.keys(ADA));
  assert.ok(parseFuseLaneStats({ ...ADA, playerId: "bot:2" }, 3));
  assert.ok(
    parseFuseLaneStats(
      { ...ADA, weeks: MAX_WEEKS + 2, netWorth: MAX_NET_WORTH, slot: 4 },
      3,
    ),
    "the largest values the boundary takes",
  );
});

test("the stats boundary refuses anything malformed, unknown or out of range", () => {
  const { shifts: _shifts, ...missing } = ADA;
  const refused: [string, unknown, number?][] = [
    ["null", null],
    ["an array", [ADA]],
    ["a string", "Ada"],
    ["a missing field", missing],
    ["an unknown field", { ...ADA, extra: 1 }],
    ["a missing field swapped for another", { ...missing, extra: 1 }],
    ["a player id that is no peer id", { ...ADA, playerId: "A".repeat(24) }],
    ["a short peer id", { ...ADA, playerId: "a".repeat(23) }],
    ["a number for an id", { ...ADA, playerId: 7 }],
    ["an empty name", { ...ADA, name: "" }],
    ["a seat past the table", { ...ADA, slot: 5 }],
    ["more round wins than rounds", { ...ADA, roundWins: 4 }],
    ["a fraction", { ...ADA, degrees: 1.5 }],
    ["a negative count", { ...ADA, shifts: -1 }],
    ["a count as text", { ...ADA, shifts: "40" }],
    ["two early exits", { ...ADA, earlyExits: 2 }],
    ["weeks past the limit", { ...ADA, weeks: MAX_WEEKS + 3 }],
    ["more than the richest", { ...ADA, netWorth: MAX_NET_WORTH + 1 }],
    ["placement 0", { ...ADA, matchPlacement: 0 }],
    ["week 0", { ...ADA, weeks: 0 }],
  ];
  for (const [what, raw] of refused)
    assert.equal(parseFuseLaneStats(raw, 3), undefined, what);
});

test("the registration: bots are not accounts, a win credits its week, a loss only what it earned", () => {
  const registration = fuseLaneRegistration;
  assert.equal(registration.id, "fuse-lane");
  assert.equal(registration.isBot("bot:1"), true);
  assert.equal(registration.isBot(ADA.playerId), false);
  assert.equal(registration.parseStats, parseFuseLaneStats);
  assert.deepEqual(registration.emptyTotals(), {
    totals: emptyFuseLaneTotals(),
  });
  assert.deepEqual(
    Object.keys(emptyFuseLaneTotals()),
    [...TOTAL_KEYS],
    "every total, at zero",
  );
  assert.ok(Object.values(emptyFuseLaneTotals()).every((value) => value === 0));
  assert.deepEqual(registration.credit(ADA, [ADA]), {
    matches: 1,
    wins: 1,
    fastestWin: 12,
    bestNetWorth: 5000,
    degrees: 2,
    shifts: 40,
  });
  const lost = { ...ADA, roundWins: 0, matchPlacement: 2, weeks: 30 };
  assert.deepEqual(registration.credit(lost, [ADA, lost]), {
    matches: 1,
    wins: 0,
    fastestWin: 0,
    bestNetWorth: 5000,
    degrees: 2,
    shifts: 40,
  });
});

test("adding up: counts sum, the best net worth is the most, the fastest win the fewest weeks a win took", () => {
  const credit = (fastestWin: number, bestNetWorth: number) => ({
    matches: 1,
    wins: fastestWin ? 1 : 0,
    fastestWin,
    bestNetWorth,
    degrees: 1,
    shifts: 10,
  });
  const standing = fuseLaneRegistration.emptyTotals();
  fuseLaneRegistration.addTotals(standing, credit(0, 900));
  assert.equal(standing.totals.fastestWin, 0, "no win yet: no fastest");
  fuseLaneRegistration.addTotals(standing, credit(20, 400));
  assert.equal(standing.totals.fastestWin, 20, "the first win");
  fuseLaneRegistration.addTotals(standing, credit(25, 3000));
  assert.equal(standing.totals.fastestWin, 20, "a slower win");
  fuseLaneRegistration.addTotals(standing, credit(0, 100));
  assert.equal(standing.totals.fastestWin, 20, "a loss keeps it");
  fuseLaneRegistration.addTotals(standing, credit(14, 100));
  assert.deepEqual(standing.totals, {
    matches: 5,
    wins: 3,
    fastestWin: 14,
    bestNetWorth: 3000,
    degrees: 5,
    shifts: 50,
  });
});

test("stored totals: missing ones start empty, malformed ones fail the read, good ones are copied", () => {
  const parse = fuseLaneRegistration.parseTotals;
  assert.deepEqual(parse({}), { totals: emptyFuseLaneTotals() });
  const good: FuseLaneTotalsRecord = {
    matches: 4,
    wins: 2,
    fastestWin: 18,
    bestNetWorth: 12_000,
    degrees: 3,
    shifts: 90,
  };
  const parsed = parse({ totals: { ...good } })!;
  assert.deepEqual(parsed, { totals: good });
  for (const totals of [
    null,
    [],
    "4",
    { ...good, wins: -1 },
    { ...good, shifts: 1.5 },
    { ...good, matches: "4" },
    (({ degrees: _degrees, ...rest }) => rest)(good),
  ])
    assert.equal(parse({ totals }), undefined, JSON.stringify(totals));
});
