import assert from "node:assert/strict";
import test from "node:test";
import { playFrame } from "../src/app/play-metrics.js";
import { ballGame, createRoom, DEFAULT_SETTINGS } from "../src/online/game.js";

test("play metrics report actual room membership and match state without names", () => {
  const room = createRoom("match", DEFAULT_SETTINGS);
  room.seats.set("a", {
    id: "a",
    name: "Ada",
    slot: 0,
    bot: false,
    connected: true,
    watcher: false,
    avatarId: "fox",
    generation: 1,
  });
  room.seats.set("bot:1", {
    id: "bot:1",
    name: "CPU",
    slot: 1,
    bot: true,
    connected: true,
    watcher: false,
    avatarId: "robot",
    generation: 1,
  });
  const lobby = playFrame(ballGame.view(room), "a", "online");
  assert.deepEqual(lobby, {
    matchId: "match",
    active: false,
    ended: false,
    playerCount: 2,
    botCount: 1,
    seated: true,
    mode: "online",
  });
  assert.equal(playFrame(ballGame.view(room), "tv", "display").seated, false);
  room.stage = "running";
  assert.equal(playFrame(ballGame.view(room), "a", "online").active, true);
  room.stage = "over";
  assert.equal(playFrame(ballGame.view(room), "a", "online").ended, true);
});
