import test from "node:test";
import assert from "node:assert/strict";
import { ACTION } from "fuse-netcode";
import { DEFAULT_SETTINGS, STEPS_PER_TICK, view } from "../src/online/index.js";
import { createGameMetrics } from "../src/app/metrics.js";
import { finish, fold, run, started } from "./fixtures/room.js";

function rig() {
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  const report = createGameMetrics((event, properties = {}) => {
    events.push({ event, properties });
  });
  return { events, report };
}

test("each decided game is reported once, when it is confirmed, with how it was won", () => {
  const { events, report } = rig();
  const room = started({ ...DEFAULT_SETTINGS, map: 2 });
  report(view(room), "a", room.tick * STEPS_PER_TICK, "online");
  finish(room, 1, "snail");
  const record = room.results[0]!;
  report(view(room), "a", record.tick * STEPS_PER_TICK - 1, "online");
  assert.equal(events.length, 0, "a rollback could still change it");
  report(view(room), "a", record.tick * STEPS_PER_TICK, "online");
  report(view(room), "a", room.tick * STEPS_PER_TICK, "online");
  assert.deepEqual(events, [
    {
      event: "Game Ended",
      properties: {
        round: 1,
        mapId: 2,
        winKind: "snail",
        winningTeam: "pink",
        durationSeconds: Math.round(record.steps / 60),
        humanCount: 2,
        botCount: 4,
        played: true,
        won: false,
        mode: "online",
      },
    },
  ]);
  assert.ok(
    !JSON.stringify(events).includes("Ada"),
    "no names, ids or room codes",
  );

  run(room, room.resumeAt - room.tick);
  finish(room, 1, "economy");
  report(view(room), "a", room.tick * STEPS_PER_TICK, "online");
  assert.equal(events.length, 2);
  assert.deepEqual(
    [events[1]!.properties.round, events[1]!.properties.winKind],
    [2, "economy"],
  );

  // A rematch is a new set: its first game is reported again.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  report(view(room), "a", room.tick * STEPS_PER_TICK, "online");
  finish(room, 0);
  report(view(room), "b", room.tick * STEPS_PER_TICK, "shared");
  assert.equal(events.length, 3);
  assert.deepEqual(
    [
      events[2]!.properties.round,
      events[2]!.properties.winKind,
      events[2]!.properties.winningTeam,
      events[2]!.properties.won,
      events[2]!.properties.mode,
    ],
    [1, "military", "cyan", false, "shared"],
  );
});

test("a watcher reports what it saw without a side, and a page that loads midway skips what was already decided", () => {
  const room = started();
  finish(room, 0);
  const late = rig();
  late.report(view(room), "a", room.tick * STEPS_PER_TICK, "online");
  assert.equal(late.events.length, 0, "decided before this page looked");

  const tv = rig();
  const fresh = started();
  tv.report(view(fresh), "", fresh.tick * STEPS_PER_TICK, "shared");
  finish(fresh, 0);
  tv.report(view(fresh), "", fresh.tick * STEPS_PER_TICK, "shared");
  assert.equal(tv.events.length, 1);
  assert.equal(tv.events[0]!.properties.played, false);
  assert.equal("won" in tv.events[0]!.properties, false);
  const winner = rig();
  const again = started();
  winner.report(view(again), "a", 0, "solo");
  finish(again, 0);
  winner.report(view(again), "a", again.tick * STEPS_PER_TICK, "solo");
  assert.equal(winner.events[0]!.properties.won, true);
});
