import assert from "node:assert/strict";
import test from "node:test";
import { playFrame } from "../src/app/play-metrics.js";
import { addBot, started } from "./fixtures/fuseDrivers.js";

test("play metrics count the actual grid, omit identities, and distinguish spectators", () => {
  const room = started(undefined, [addBot("bot:1", 2)]);
  const frame = playFrame(room, "a", "online");
  assert.deepEqual(frame, {
    matchId: "m1",
    active: true,
    ended: false,
    round: 1,
    playerCount: 3,
    botCount: 1,
    seated: true,
    mode: "online",
  });
  assert.equal(playFrame(room, "tv", "display").seated, false);
  room.stage = "over";
  assert.equal(playFrame(room, "a", "online").ended, true);
  assert.equal(playFrame(room, "a", "online").active, false);
});
