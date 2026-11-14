import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, type SeatRecord } from "fuse-netcode";
import { createPlayMetrics } from "fuse-ui/play-metrics";
import { frontPlayFrame } from "../src/app/play-metrics.js";
import {
  createRoom,
  DEFAULT_SETTINGS,
  foldTick,
  view,
  type Entry,
} from "../src/online/game.js";

function match() {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  const entries: Entry[] = [
    [1, 1, JOIN, "self", "Private name", 0, "brick", 1],
  ];
  const streams = new Map([["self", { generation: 1, entries }]]);
  foldTick(room, "self", streams);
  entries.push([2, 2, ACTION, "start", "match-1"]);
  foldTick(room, "self", streams);
  return room;
}

test("Front reports the funnel once, counts bot-filled slots and scopes rematches", () => {
  const room = match();
  const events: { event: string; properties: unknown }[] = [];
  const report = createPlayMetrics(
    (event, properties) => events.push({ event, properties }),
    () => 0,
  );
  const playing = frontPlayFrame(view(room), "self", false, false);
  assert.equal(playing.playerCount, room.world!.players.length);
  assert.equal(playing.botCount, playing.playerCount - 1);
  assert.equal(playing.seated, true);
  assert.equal(playing.mode, "solo");
  report(playing);
  report(playing);
  room.stage = "over";
  const ended = frontPlayFrame(view(room), "self", false, false);
  report(ended);
  report(ended);
  report({ ...playing, matchId: "rematch" });
  assert.deepEqual(
    events.map(({ event }) => event),
    ["Seat Taken", "Match Started", "Match Ended", "Match Started"],
  );
  assert.ok(!JSON.stringify(events).includes("Private name"));
  assert.ok(!JSON.stringify(events).includes("match-1"));
});

test("Front lobby, disconnected players, spectators and displays keep accurate counts", () => {
  const room = match();
  const self = room.seats.get("self")!;
  self.connected = false;
  assert.equal(
    frontPlayFrame(view(room), "self", false, true).botCount,
    room.world!.players.length,
  );
  const watcher: SeatRecord = {
    ...self,
    id: "watcher",
    slot: -1,
    watcher: true,
    connected: true,
  };
  room.seats.set(watcher.id, watcher);
  assert.equal(
    frontPlayFrame(view(room), "watcher", false, true).seated,
    false,
  );
  const display = frontPlayFrame(view(room), "self", true, true);
  assert.equal(display.seated, false);
  assert.equal(display.mode, "shared");
  room.play.display = true;
  assert.equal(frontPlayFrame(view(room), "self", false, true).mode, "shared");
  room.stage = "lobby";
  room.world = null;
  const lobby = frontPlayFrame(view(room), "self", false, true);
  assert.equal(lobby.active, false);
  assert.equal(lobby.ended, false);
  assert.equal(lobby.playerCount, 1);
  assert.equal(lobby.botCount, 0);
  room.settings.display = true;
  assert.equal(frontPlayFrame(view(room), "self", false, true).mode, "shared");
});
