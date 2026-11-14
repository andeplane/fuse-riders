import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyFuseSurgeTotals,
  fuseSurgeRegistration,
  parseFuseSurgeStats,
  validFuseSurgeField,
  type FuseSurgeStats,
} from "../src/platform.js";
import {
  GAME_ID,
  MAX_TARGET,
  MOST_DODGES,
  MOST_TAKEN,
  isBotId,
  validName,
} from "../src/basics.js";

const ID = "a".repeat(24),
  OTHER = "b".repeat(24);
const stats = (more: Partial<FuseSurgeStats> = {}): FuseSurgeStats => ({
  playerId: ID,
  name: "Ada",
  slot: 0,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 3,
  matchPlacement: 1,
  earlyExits: 0,
  points: 3,
  dodges: 120,
  hits: 4,
  ...more,
});

test("a rider's stats are accepted only whole, known and within one match", () => {
  assert.deepEqual(parseFuseSurgeStats(stats(), 1), stats());
  // Rebuilt in one key order, whatever order they came in.
  const shuffled = Object.fromEntries(Object.entries(stats()).reverse());
  assert.deepEqual(
    Object.keys(parseFuseSurgeStats(shuffled, 1)!),
    Object.keys(stats()),
  );
  assert.ok(parseFuseSurgeStats(stats({ playerId: "bot:3" }), 1));
  assert.ok(
    parseFuseSurgeStats(
      stats({ roundWins: 0, matchPlacement: 2, matchScoreUnits: 0, points: 0 }),
      1,
    ),
  );
  assert.ok(
    parseFuseSurgeStats(
      stats({
        matchScoreUnits: MAX_TARGET,
        points: MAX_TARGET,
        dodges: MOST_DODGES,
        hits: MOST_TAKEN,
      }),
      1,
    ),
  );
  const bad: unknown[] = [
    null,
    [],
    "stats",
    { ...stats(), extra: 1 },
    (({ hits: _hits, ...rest }) => rest)(stats()),
    stats({ playerId: "someone" }),
    stats({ name: "" }),
    stats({ slot: 5 }),
    stats({ slot: -1 }),
    stats({ roundsPlayed: 0 }),
    stats({ roundsPlayed: 2 }),
    stats({ roundWins: 2 }),
    stats({ matchPlacement: 0 }),
    stats({ matchPlacement: 6 }),
    stats({ matchPlacement: 2 }),
    stats({ roundWins: 0 }),
    stats({ matchScoreUnits: MAX_TARGET + 1, points: MAX_TARGET + 1 }),
    stats({ matchScoreUnits: 0, points: 0 }),
    stats({ points: 2 }),
    stats({ dodges: MOST_DODGES + 1 }),
    stats({ hits: MOST_TAKEN + 1 }),
    stats({ hits: 1.5 }),
    stats({ earlyExits: 2 }),
  ];
  for (const raw of bad)
    assert.equal(parseFuseSurgeStats(raw, 1), undefined, JSON.stringify(raw));
  assert.equal(
    parseFuseSurgeStats(stats(), 2),
    undefined,
    "a match reports as one round",
  );
  assert.equal(GAME_ID, fuseSurgeRegistration.id);
  assert.ok(isBotId("bot:12") && !isBotId("bot:") && !isBotId("robot"));
  assert.ok(
    validName("Ada") && !validName(" Ada") && !validName("x".repeat(19)),
  );
  assert.ok(fuseSurgeRegistration.isBot("bot:1"));
});

test("the field is two to five riders in the first lanes, each placed by its round wins", () => {
  const loser = stats({
    playerId: OTHER,
    slot: 1,
    roundWins: 0,
    matchScoreUnits: 1,
    matchPlacement: 2,
    points: 1,
  });
  assert.ok(validFuseSurgeField([stats(), loser]));
  // A draw: level on wins, both first; the rider behind them is third.
  const level = stats({ playerId: OTHER, slot: 1 });
  const third = stats({
    playerId: "bot:1",
    slot: 2,
    roundWins: 0,
    matchScoreUnits: 2,
    matchPlacement: 3,
    points: 2,
  });
  assert.ok(validFuseSurgeField([stats(), level, third]));
  assert.equal(
    validFuseSurgeField([stats()]),
    false,
    "one rider is not a match",
  );
  assert.equal(
    validFuseSurgeField(
      Array.from({ length: 6 }, (_, slot) => stats({ slot })),
    ),
    false,
  );
  assert.equal(
    validFuseSurgeField([stats(), stats()]),
    false,
    "one lane twice",
  );
  assert.equal(
    validFuseSurgeField([stats(), { ...loser, slot: 3 }]),
    false,
    "a gap in the lanes",
  );
  assert.equal(
    validFuseSurgeField([stats(), { ...loser, matchPlacement: 1 }]),
    false,
    "behind on wins is not first",
  );
  assert.equal(
    validFuseSurgeField([stats({ matchPlacement: 2 }), level]),
    false,
    "level on wins is not second",
  );
  assert.equal(
    validFuseSurgeField([stats(), level, { ...third, matchPlacement: 2 }]),
    false,
  );
});

test("a confirmed match adds to an account's totals, which are read back strictly", () => {
  const standing = fuseSurgeRegistration.emptyTotals();
  assert.deepEqual(standing.totals, emptyFuseSurgeTotals());
  const won = fuseSurgeRegistration.credit(stats(), []),
    lost = fuseSurgeRegistration.credit(
      stats({
        matchPlacement: 2,
        roundWins: 0,
        points: 1,
        dodges: 30,
        hits: 3,
      }),
      [],
    );
  fuseSurgeRegistration.addTotals(standing, won);
  fuseSurgeRegistration.addTotals(standing, lost);
  assert.deepEqual(standing.totals, {
    matches: 2,
    wins: 1,
    points: 4,
    dodges: 150,
    hits: 7,
  });
  assert.deepEqual(fuseSurgeRegistration.parseTotals({}), {
    totals: emptyFuseSurgeTotals(),
  });
  assert.deepEqual(
    fuseSurgeRegistration.parseTotals({
      rating: 1200,
      totals: standing.totals,
    }),
    standing,
  );
  for (const totals of [
    null,
    [],
    "totals",
    { ...standing.totals, wins: -1 },
    { ...standing.totals, dodges: "many" },
    { matches: 1 },
  ])
    assert.equal(fuseSurgeRegistration.parseTotals({ totals }), undefined);
});
