import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_GAME_FIELD,
  LEGACY_GAME_ID,
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
