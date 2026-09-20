import test from "node:test";
import assert from "node:assert/strict";
import { MAX_MATCH_PARTICIPANTS } from "fuse-platform";
import {
  CAPACITY,
  MAX_EVENTS,
  MAX_LAPS,
  MAX_NAME,
  MAX_PROGRESS_UNITS,
  MAX_ROUNDS,
} from "../src/game/basics.js";
import {
  TOTAL_KEYS,
  emptyFuseDriversTotals,
  fuseDriversRegistration,
  parseFuseDriversStats,
} from "../src/platform.js";
import { defined } from "./fixtures/defined.js";

/** The one key order every accepted report is rebuilt in, so equal results hash equally. */
const ORDER = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
  "laps",
  "kills",
  "deaths",
  "lapsLed",
  "nitrosUsed",
];

const ID = "0123456789abcdef01234567";

/** A well-formed one-round report, as a plain record so a test can bend any single field. */
const stats = (
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  playerId: ID,
  name: "Ada",
  slot: 1,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 12_345,
  matchPlacement: 1,
  earlyExits: 0,
  laps: 4,
  kills: 3,
  deaths: 2,
  lapsLed: 2,
  nitrosUsed: 5,
  ...extra,
});

const accepted = (raw: unknown, rounds = 1) =>
  defined(parseFuseDriversStats(raw, rounds), "accepted report");
const refused = (raw: unknown, why: string, rounds = 1) =>
  assert.equal(parseFuseDriversStats(raw, rounds), undefined, why);

test("a well-formed report is accepted and rebuilt in one key order", () => {
  const raw = stats();
  // A client that sent the same fields in another order must produce the same record.
  const shuffled: Record<string, unknown> = {};
  for (const key of [...ORDER].reverse()) shuffled[key] = raw[key];
  assert.notDeepEqual(Object.keys(shuffled), ORDER, "the input is shuffled");

  const player = accepted(shuffled);
  assert.deepEqual(Object.keys(player), ORDER);
  assert.deepEqual({ ...player }, raw);
  assert.equal(player.playerId, ID);
  assert.equal(player.laps, 4);
  assert.equal(player.lapsLed, 2);
});

test("a report that is not a plain record is refused", () => {
  refused(undefined, "undefined");
  refused(null, "null");
  refused(0, "a number");
  refused("Ada", "a string");
  refused([], "an array");
  refused(Object.values(stats()), "an array of the values");
});

test("a report with a missing, renamed or unknown key is refused", () => {
  const short = stats();
  delete short.nitrosUsed;
  refused(short, "a missing key");

  refused(stats({ extra: 1 }), "an unknown extra key");

  // Same number of keys, but one of them is not a key of the report.
  const renamed = stats({ hits: 3 });
  delete renamed.kills;
  assert.equal(Object.keys(renamed).length, ORDER.length);
  refused(renamed, "a renamed key");
});

test("a bad player id or name is refused, and a bot id is recognised", () => {
  refused(stats({ playerId: 42 }), "an id that is not a string");
  refused(stats({ playerId: ID.slice(0, 23) }), "too few hex digits");
  refused(stats({ playerId: `${ID}0` }), "too many hex digits");
  refused(stats({ playerId: ID.toUpperCase() }), "upper case hex");
  refused(stats({ playerId: "bot:" }), "a bot id with no number");
  refused(stats({ playerId: "bot:1234567" }), "a bot number that is too long");

  assert.equal(accepted(stats({ playerId: "bot:7" })).playerId, "bot:7");
  assert.ok(fuseDriversRegistration.isBot("bot:7"));
  assert.ok(fuseDriversRegistration.isBot("bot:123456"));
  assert.ok(!fuseDriversRegistration.isBot(ID));
  assert.ok(!fuseDriversRegistration.isBot("bot:x"));

  refused(stats({ name: "" }), "an empty name");
  refused(stats({ name: " Ada " }), "an untrimmed name");
  refused(stats({ name: "x".repeat(MAX_NAME + 1) }), "a name that is too long");
  // Built rather than written literally: a control character has no place in a source file.
  refused(
    stats({ name: `Ad${String.fromCodePoint(0)}a` }),
    "a control character",
  );
  refused(
    stats({ name: `Ada${String.fromCharCode(0xd800)}` }),
    "half a surrogate pair",
  );
  refused(stats({ name: 7 }), "a name that is not a string");
});

test("a counter that is not a whole number in range is refused", () => {
  refused(stats({ kills: 1.5 }), "a fraction");
  refused(stats({ kills: Number.NaN }), "NaN");
  refused(stats({ kills: Number.POSITIVE_INFINITY }), "infinity");
  refused(stats({ kills: "3" }), "a numeric string");
  refused(stats({ deaths: -1 }), "a negative count");

  refused(stats({ slot: CAPACITY }), "a slot past the grid");
  assert.equal(accepted(stats({ slot: CAPACITY - 1 })).slot, CAPACITY - 1);
  refused(stats({ roundsPlayed: 2 }), "more rounds than the result has");
  assert.equal(accepted(stats({ roundsPlayed: 2 }), 2).roundsPlayed, 2);
  refused(stats({ roundWins: 2 }), "more round wins than rounds");
  refused(
    stats({ matchScoreUnits: MAX_PROGRESS_UNITS * MAX_ROUNDS + 1 }),
    "progress past a whole series",
  );
  refused(
    stats({ matchPlacement: MAX_MATCH_PARTICIPANTS + 1 }),
    "a placement past the field",
  );
  refused(stats({ earlyExits: 2 }), "more early exits than one");
  refused(stats({ laps: MAX_LAPS + 1, lapsLed: 0 }), "laps past the bound");
  refused(stats({ kills: MAX_EVENTS + 1 }), "kills past the bound");
  refused(stats({ deaths: MAX_EVENTS + 1 }), "deaths past the bound");
  refused(
    stats({ laps: MAX_LAPS, lapsLed: MAX_LAPS + 1 }),
    "laps led past the bound",
  );
  refused(stats({ nitrosUsed: MAX_EVENTS + 1 }), "nitros past the bound");
});

test("placement starts at one and a driver cannot lead more laps than it drove", () => {
  refused(stats({ matchPlacement: 0 }), "a placement below first");
  assert.equal(accepted(stats({ matchPlacement: 1 })).matchPlacement, 1);
  refused(stats({ laps: 3, lapsLed: 4 }), "more laps led than driven");
  assert.equal(accepted(stats({ laps: 3, lapsLed: 3 })).lapsLed, 3);
});

test("empty totals are zero, in key order, and fresh on every call", () => {
  const totals = emptyFuseDriversTotals();
  assert.deepEqual(Object.keys(totals), [...TOTAL_KEYS]);
  assert.deepEqual(
    Object.values(totals),
    TOTAL_KEYS.map(() => 0),
  );
  totals.kills = 9;
  assert.equal(emptyFuseDriversTotals().kills, 0, "a fresh record each call");
  assert.deepEqual(fuseDriversRegistration.emptyTotals(), {
    totals: emptyFuseDriversTotals(),
  });
});

test("a confirmed match credits the driver's counters and a win only for first", () => {
  assert.equal(fuseDriversRegistration.id, "fuse-drivers");
  assert.equal(fuseDriversRegistration.parseStats, parseFuseDriversStats);

  const winner = accepted(stats());
  const credit = fuseDriversRegistration.credit(winner, [winner]);
  assert.deepEqual(credit, {
    matches: 1,
    wins: 1,
    roundWins: 1,
    laps: 4,
    kills: 3,
    deaths: 2,
    lapsLed: 2,
    nitrosUsed: 5,
  });

  const second = accepted(
    stats({
      matchPlacement: 2,
      roundWins: 0,
      laps: 3,
      kills: 0,
      deaths: 1,
      lapsLed: 0,
      nitrosUsed: 2,
    }),
  );
  const loss = fuseDriversRegistration.credit(second, [winner, second]);
  assert.equal(loss.wins, 0, "only first place wins the match");
  assert.equal(loss.matches, 1);

  const standing = fuseDriversRegistration.emptyTotals();
  fuseDriversRegistration.addTotals(standing, credit);
  fuseDriversRegistration.addTotals(standing, loss);
  assert.deepEqual(standing.totals, {
    matches: 2,
    wins: 1,
    roundWins: 1,
    laps: 7,
    kills: 3,
    deaths: 3,
    lapsLed: 2,
    nitrosUsed: 7,
  });
});

test("stored totals are rebuilt in key order, and a malformed document is refused", () => {
  assert.deepEqual(
    fuseDriversRegistration.parseTotals({}),
    { totals: emptyFuseDriversTotals() },
    "an account that has never played starts empty",
  );
  assert.deepEqual(fuseDriversRegistration.parseTotals({ rating: 1200 }), {
    totals: emptyFuseDriversTotals(),
  });

  const stored: Record<string, unknown> = {};
  for (const [index, key] of [...TOTAL_KEYS].reverse().entries())
    stored[key] = index + 1;
  const parsed = defined(
    fuseDriversRegistration.parseTotals({ totals: stored }),
    "parsed totals",
  );
  assert.deepEqual(Object.keys(parsed.totals), [...TOTAL_KEYS]);
  assert.deepEqual(
    TOTAL_KEYS.map((key) => parsed.totals[key]),
    TOTAL_KEYS.map((key) => stored[key]),
  );

  const refusedTotals = (totals: unknown, why: string) =>
    assert.equal(
      fuseDriversRegistration.parseTotals({ totals }),
      undefined,
      why,
    );
  refusedTotals(null, "totals that are not a record");
  refusedTotals([], "an array");
  refusedTotals("totals", "a string");
  refusedTotals(0, "a number");
  const missing: Record<string, unknown> = { ...emptyFuseDriversTotals() };
  delete missing.kills;
  refusedTotals(missing, "a missing key");
  refusedTotals({ ...emptyFuseDriversTotals(), wins: -1 }, "a negative total");
  refusedTotals({ ...emptyFuseDriversTotals(), laps: 1.5 }, "a fraction");
  refusedTotals(
    { ...emptyFuseDriversTotals(), matches: Number.MAX_SAFE_INTEGER + 2 },
    "a count past the safe range",
  );
  // Unknown stored fields are dropped by the rebuild rather than carried through.
  const extra = defined(
    fuseDriversRegistration.parseTotals({
      totals: { ...emptyFuseDriversTotals(), podiums: 3 },
    }),
    "totals with an unknown field",
  );
  assert.deepEqual(extra.totals, emptyFuseDriversTotals());
});
test("a report cannot win more races than it raced", () => {
  assert.ok(parseFuseDriversStats(stats({ roundsPlayed: 1, roundWins: 1 }), 2));
  assert.equal(
    parseFuseDriversStats(stats({ roundsPlayed: 0, roundWins: 1 }), 2),
    undefined,
  );
});
