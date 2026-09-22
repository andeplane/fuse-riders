import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_GAME_FIELD,
  LEGACY_GAME_ID,
  feedlessMatchStamps,
  legacyMatchIds,
} from "../src/index.js";

test("a backfill picks only records without a gameId, and writes the legacy game", () => {
  const page = [
    { id: "old", data: { matchId: "m1" } },
    { id: "fuse", data: { matchId: "m2", gameId: LEGACY_GAME_ID } },
    { id: "dice", data: { matchId: "m3", gameId: "dice" } },
    { id: "odd", data: { matchId: "m4", gameId: 7 } },
  ];
  assert.deepEqual(legacyMatchIds(page), ["old"]);
  assert.deepEqual(legacyMatchIds([]), []);
  assert.deepEqual(LEGACY_GAME_FIELD, { gameId: "fuse-riders" });
});

test("the feed backfill stamps exactly the games confirmation would have published", () => {
  const whole = (data: Record<string, unknown>) => ({
    status: "confirmed",
    endedAt: 1000,
    result: { winner: "a" },
    attesters: ["a", "b"],
    uidByPlayer: {},
    ...data,
  });
  const page = [
    { id: "attested", data: whole({}) },
    // One rider's own account vouches for it, however few attested.
    {
      id: "account",
      data: whole({ attesters: ["a"], uidByPlayer: { a: "u" } }),
    },
    { id: "lone-guest", data: whole({ attesters: ["a"] }) },
    { id: "round", data: whole({ result: { winner: "a", round: 2 } }) },
    { id: "pending", data: whole({ status: "pending", endedAt: undefined }) },
    { id: "unended", data: whole({ endedAt: undefined }) },
    { id: "broken-end", data: whole({ endedAt: "soon" }) },
    // Already published: left alone, which is what makes a rerun a no-op. A feed time the parser would refuse is
    // still a feed time the backfill did not write, so it is the reader's to judge, not this script's to correct.
    { id: "listed", data: whole({ feedAt: 900 }) },
    { id: "bad-feed", data: whole({ feedAt: "soon" }) },
    // Nothing a corrupt record can hold may throw here: one unreadable document must not stop the page.
    { id: "no-result", data: whole({ result: undefined }) },
    { id: "odd-result", data: whole({ result: "winner: a" }) },
    { id: "odd-attesters", data: whole({ attesters: "a, b" }) },
    { id: "odd-accounts", data: whole({ attesters: ["a"], uidByPlayer: 7 }) },
  ];
  assert.deepEqual(feedlessMatchStamps(page), [
    { id: "attested", feedAt: 1000 },
    { id: "account", feedAt: 1000 },
  ]);
  assert.deepEqual(feedlessMatchStamps([]), []);
  // A second pass over the page it already wrote asks for nothing more.
  assert.deepEqual(
    feedlessMatchStamps(
      page.map(({ id, data }) =>
        id === "attested" || id === "account"
          ? { id, data: { ...data, feedAt: 1000 } }
          : { id, data },
      ),
    ),
    [],
  );
});
