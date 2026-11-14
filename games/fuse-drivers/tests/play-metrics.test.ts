import assert from "node:assert/strict";
import test from "node:test";
import { playFrame, confirmedPlayFrame } from "../src/app/play-metrics.js";
import { fuseDriversView } from "../src/game/index.js";
import { addBot, started } from "./fixtures/fuseDrivers.js";

test("play metrics count the actual grid, omit identities, and distinguish spectators", () => {
  const room = started(undefined, [addBot("bot:1", 2)]);
  const frame = playFrame(room, "a", "online");
  assert.deepEqual(frame, {
    matchId: "m1",
    roundActive: false,
    roundEnded: false,
    active: true,
    ended: false,
    round: 1,
    playerCount: 3,
    botCount: 1,
    seated: true,
    mode: "online",
  });
  assert.equal(playFrame(room, "tv", "display").seated, false);
  room.race = { ...room.race!, phase: "racing" };
  assert.equal(playFrame(room, "a", "online").roundActive, true);
  room.race = { ...room.race!, phase: "finished" };
  assert.equal(playFrame(room, "a", "online").roundEnded, false);
  room.stage = "over";
  assert.equal(playFrame(room, "a", "online").ended, true);
  assert.equal(playFrame(room, "a", "online").active, false);
});

test("a predicted race finish cannot complete a round; final views keep their own roster", () => {
  const room = started();
  room.race = { ...room.race!, phase: "finished" };
  assert.equal(playFrame(room, "a", "online").roundEnded, false);
  const final = {
    ...fuseDriversView(room),
    matchId: room.matchId,
    logTick: room.tick,
    managerId: "a",
  };
  room.seats.clear();
  room.matchId = "next-match";
  const complete = confirmedPlayFrame(final, "a", "online");
  assert.equal(complete.roundEnded, true);
  assert.equal(complete.matchId, "m1");
  assert.equal(complete.seated, true);
  assert.equal(complete.playerCount, 2);
});
