import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalytics,
  type AnalyticsEnvironment,
  type MixpanelLike,
} from "../src/analytics.js";
import { createMemoryStorage } from "../src/safe-storage.js";
import { createPlayMetrics, type PlayFrame } from "../src/play-metrics.js";

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

test("all games use the same namespace and an unforgeable gameId, including across navigation", async () => {
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  const stored: Record<string, unknown> = { gameId: "stale-game" };
  const sdk: MixpanelLike = {
    init() {},
    register(properties) {
      Object.assign(stored, properties);
    },
    track(event, properties) {
      events.push({ event, properties: { ...stored, ...properties } });
    },
    has_opted_out_tracking: () => false,
    opt_out_tracking() {},
    clear_opt_in_out_tracking() {},
  };
  const environment: AnalyticsEnvironment = {
    load: async () => sdk,
    storage: createMemoryStorage(),
    search: () => "?room=AB42",
    port: () => "",
    doNotTrack: () => false,
  };
  for (const gameId of [
    "fuse-riders",
    "dice",
    "fuse-axe",
    "fuse-bombers",
    "fuse-choppers",
    "fuse-craft",
    "fuse-freight",
    "fuse-lane",
    "hook-havok",
  ]) {
    const analytics = createAnalytics(gameId, environment);
    analytics.start({ gameId: "wrong-game", role: "solo" });
    analytics.track("App Opened", {
      gameId: "wrong-event",
      status: "Room AB42 https://example.com/?room=AB42",
    });
    analytics.track("Match Ended");
    await settle();
    assert.deepEqual(
      events.slice(-2).map((event) => [event.event, event.properties.gameId]),
      [
        ["fuse.App Opened", gameId],
        ["fuse.Match Ended", gameId],
      ],
    );
    assert.equal(events.at(-2)!.properties.status, "Room [redacted] [url]");
  }
});

const playing: PlayFrame = {
  matchId: "one",
  active: true,
  ended: false,
  round: 1,
  playerCount: 3,
  botCount: 2,
  seated: true,
  mode: "solo",
};

test("real play deduplicates frames, rounds and corrected results, and measures each rematch separately", () => {
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  let time = 0;
  const frame = createPlayMetrics(
    (event, properties) => events.push({ event, properties }),
    () => time,
  );
  frame({ ...playing, matchId: "", active: false });
  frame({ ...playing, active: false }); // lobby: seated, not started
  frame(playing);
  frame(playing);
  time = 9_000;
  frame({ ...playing, round: 2 });
  frame({ ...playing, active: false, ended: true, round: 2 });
  frame({ ...playing, active: false, ended: true, round: 2 });
  frame(playing); // rollback to running must not repeat start
  frame({ ...playing, ended: true });
  assert.deepEqual(
    events.map((e) => e.event),
    ["Seat Taken", "Match Started", "Match Ended"],
  );
  assert.equal(events.at(-1)!.properties?.durationSeconds, 9);
  time = 20_000;
  frame({ ...playing, matchId: "two" });
  time = 23_000;
  frame({ ...playing, matchId: "two", active: false, ended: true });
  assert.deepEqual(
    events.slice(-2).map((e) => e.event),
    ["Match Started", "Match Ended"],
  );
  assert.equal(events.at(-1)!.properties?.durationSeconds, 3);
  assert.equal(JSON.stringify(events).includes("matchId"), false);
});

test("late spectators report results without inventing a seat, start or duration; free play never invents an end", () => {
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  const frame = createPlayMetrics(
    (event, properties) => events.push({ event, properties }),
    () => 0,
  );
  frame({ ...playing, round: 3, seated: false });
  frame({ ...playing, round: 3, seated: false, active: false, ended: true });
  assert.deepEqual(
    events.map((e) => e.event),
    ["Match Ended"],
  );
  assert.equal(events[0]!.properties?.played, false);
  assert.equal(events[0]!.properties?.durationSeconds, undefined);
  for (let i = 0; i < 10; i++)
    frame({
      ...playing,
      matchId: "free",
      round: undefined,
      seated: false,
      mode: "free",
    });
  assert.deepEqual(
    events.map((e) => e.event),
    ["Match Ended", "Match Started"],
  );
});

test("opening a finished first-round contest never invents a zero-second match", () => {
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  const frame = createPlayMetrics(
    (event, properties) => events.push({ event, properties }),
    () => 0,
  );
  frame({ ...playing, active: true, ended: true, seated: false });
  frame({ ...playing, active: false, ended: true, seated: false });
  assert.deepEqual(
    events.map((event) => event.event),
    ["Match Ended"],
  );
  assert.equal(events[0]!.properties?.durationSeconds, undefined);
});
