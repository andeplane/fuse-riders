import { test } from "node:test";
import assert from "node:assert/strict";
import { birdsRegistration, parseBirdStats } from "../src/platform.js";
import {
  roomFailure,
  roomToken,
  safeStore,
  storageKeys,
} from "../src/app/session.js";
const player = {
  playerId: "a".repeat(24),
  name: "Skye",
  slot: 0,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 100,
  matchPlacement: 1,
  earlyExits: 0,
};
test("platform validates one-round results and stored account totals", () => {
  assert.deepEqual(parseBirdStats(player, 1), player);
  for (const bad of [
    null,
    [],
    { ...player, extra: true },
    { ...player, playerId: "bot" },
    { ...player, slot: 5 },
    { ...player, roundWins: 2 },
    { ...player, matchPlacement: 0 },
  ])
    assert.equal(parseBirdStats(bad, 1), undefined);
  assert.equal(parseBirdStats(player, 2), undefined);
  const total = birdsRegistration.emptyTotals();
  birdsRegistration.addTotals(
    total,
    birdsRegistration.credit(player, [player]),
  );
  assert.deepEqual(total, { totals: { matches: 1, wins: 1 } });
  assert.deepEqual(
    birdsRegistration.parseTotals({}),
    birdsRegistration.emptyTotals(),
  );
  assert.deepEqual(
    birdsRegistration.parseTotals({ totals: total.totals }),
    total,
  );
  assert.equal(
    birdsRegistration.parseTotals({ totals: { matches: 1, wins: 2 } }),
    undefined,
  );
  assert.equal(birdsRegistration.isBot("bird"), false);
});
test("private room credentials never enter public links and display tokens do not take a player's identity", () => {
  const store = safeStore(() => {
    throw new Error("Storage disabled");
  });
  let n = 0;
  const secret = () => `secret-${++n}`;
  const peer = roomToken(store, "ABC123", false, secret);
  assert.equal(roomToken(store, "ABC123", false, secret), peer);
  assert.notEqual(roomToken(store, "ABC123", true, secret), peer);
  store.set(storageKeys.host("ABC123"), "host-capability");
  assert.equal(roomToken(store, "ABC123", false, secret), "host-capability");
  assert.notEqual(roomToken(store, "ABC123", true, secret), "host-capability");
  assert.match(roomFailure(new Error("unknown game")), /not enabled/);
  assert.match(roomFailure("another game"), /another game/);
  assert.equal(roomFailure("Offline"), "Offline");
});
