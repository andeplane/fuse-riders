import assert from "node:assert/strict";
import test from "node:test";
import { playFrame } from "../src/app/play-metrics.js";
import { addBot, started } from "./fixtures/fuseDrivers.js";

test("play metrics count the actual grid, omit identities, and distinguish spectators", () => {
  const room = started(undefined, [addBot("bot:1", 2)]);
  const frame = playFrame(room, "a", "online", room.finishTick);
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
  assert.equal(playFrame(room, "tv", "display", room.finishTick).seated, false);
  room.race = { ...room.race!, phase: "racing" };
  assert.equal(
    playFrame(room, "a", "online", room.finishTick).roundActive,
    true,
  );
  room.race = { ...room.race!, phase: "finished" };
  assert.equal(
    playFrame(room, "a", "online", room.finishTick).roundEnded,
    true,
  );
  room.stage = "over";
  assert.equal(playFrame(room, "a", "online", room.finishTick).ended, true);
  assert.equal(playFrame(room, "a", "online", room.finishTick).active, false);
});

test("a predicted finish stays provisional until its deciding tick is confirmed", () => {
  const room = started();
  room.race = { ...room.race!, phase: "finished" };
  room.finishTick = 50;
  assert.equal(playFrame(room, "a", "online", 49).roundEnded, false);
  room.race = { ...room.race!, phase: "racing" };
  assert.equal(playFrame(room, "a", "online", 50).roundEnded, false);
  room.race = { ...room.race!, phase: "finished" };
  room.finishTick = 60;
  assert.equal(playFrame(room, "a", "online", 59).roundEnded, false);
  assert.equal(playFrame(room, "a", "online", 60).roundEnded, true);
});
