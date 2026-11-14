import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalytics,
  type AnalyticsEnvironment,
  OPT_OUT_KEY,
} from "../src/analytics.js";
import {
  ANALYTICS_QUEUE_KEY,
  ANALYTICS_USER_KEY,
  SESSION_IDLE_MS,
  MAX_QUEUED_EVENTS,
} from "../src/analytics-client.js";
import { createMemoryStorage, type SafeStorage } from "../src/safe-storage.js";
import { createPlayMetrics, type PlayFrame } from "../src/play-metrics.js";
import type { TelemetryEvent } from "fuse-telemetry/contracts";
const settle = async () => {
  for (let i = 0; i < 3000; i++) await Promise.resolve();
};
let serial = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, "0")}`;
function fixture(storage: SafeStorage = createMemoryStorage()) {
  let time = 100000,
    off = false,
    fail = false;
  let timer: (() => void) | undefined,
    onFlush = () => {},
    onStorage = (_key: string | null) => {};
  const sent: TelemetryEvent[][] = [];
  const environment: AnalyticsEnvironment = {
    storage,
    now: () => time,
    uuid,
    schedule: (callback) => {
      timer = callback;
      return () => {
        timer = undefined;
      };
    },
    exclusive: async (operation) => operation(),
    send: async (events) => {
      sent.push(structuredClone(events));
      if (fail) throw new Error("offline");
      return events.map((event) => event.id);
    },
    search: () => "?room=AB42",
    port: () => "",
    doNotTrack: () => off,
    onFlush: (listener) => {
      onFlush = listener;
    },
    onStorage: (listener) => {
      onStorage = listener;
    },
  };
  return {
    storage,
    sent,
    environment,
    create: (game = "dice") => createAnalytics(game, environment),
    time: (value: number) => {
      time = value;
    },
    dnt: () => {
      off = true;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    storageEvent: (key: string | null) => onStorage(key),
    flush: async () => {
      await settle();
      const callback = timer;
      timer = undefined;
      (callback ?? onFlush)();
      await settle();
    },
  };
}
test("first-party delivery preserves namespace, game ownership and property scrubbing across navigation", async () => {
  const f = fixture();
  for (const game of ["dice", "fuse-riders", "fuse-front", "fuseos"]) {
    const analytics = f.create(game);
    analytics.start({ role: "solo", gameId: "wrong" });
    analytics.track("App Opened", {
      gameId: "wrong",
      status: "Room AB42 https://example.com/?room=AB42",
      email: "bad@example.com",
      token: "secret",
      infinite: Infinity,
    });
    await f.flush();
  }
  assert.deepEqual(
    f.sent.flat().map((event) => [event.name, event.gameId]),
    ["dice", "fuse-riders", "fuse-front", "fuseos"].map((game) => [
      "fuse.App Opened",
      game,
    ]),
  );
  for (const event of f.sent.flat()) {
    assert.deepEqual(event.properties, {
      role: "solo",
      status: "Room [redacted] [url]",
    });
    assert.equal(event.v, 1);
  }
  assert.equal(new Set(f.sent.flat().map((event) => event.userId)).size, 1);
  assert.equal(new Set(f.sent.flat().map((event) => event.sessionId)).size, 1);
});
test("network retry and page reload retain event ids; acknowledged events leave the persisted outbox", async () => {
  const f = fixture();
  f.fail(true);
  const analytics = f.create();
  analytics.start({});
  analytics.track("App Opened");
  await f.flush();
  const first = f.sent[0]![0]!;
  const next = fixture(f.storage);
  next.time(first.occurredAt + 100);
  next.create().start({});
  await next.flush();
  assert.deepEqual(next.sent[0]![0], first);
  assert.deepEqual(JSON.parse(f.storage.getItem(ANALYTICS_QUEUE_KEY)!), []);
});
test("sessions span games and expire at 30 minutes of inactivity without changing browser identity", async () => {
  const f = fixture();
  const a = f.create();
  a.start({});
  a.track("App Opened");
  await f.flush();
  f.time(100000 + SESSION_IDLE_MS - 1);
  a.track("Seat Taken");
  await f.flush();
  f.time(100000 + 2 * SESSION_IDLE_MS);
  a.track("Match Started");
  await f.flush();
  const events = f.sent.flat();
  assert.equal(events[0]!.sessionId, events[1]!.sessionId);
  assert.notEqual(events[1]!.sessionId, events[2]!.sessionId);
  assert.equal(events[0]!.userId, events[2]!.userId);
});
test("DNT, local addresses and opt-out create no identity and send no pending events", async () => {
  for (const mode of ["dnt", "local", "optout"] as const) {
    const f = fixture();
    if (mode === "dnt") f.dnt();
    if (mode === "local") f.environment.port = () => "5173";
    if (mode === "optout") f.storage.setItem(OPT_OUT_KEY, "1");
    const a = f.create();
    a.start({});
    a.track("App Opened");
    await f.flush();
    assert.equal(f.storage.getItem(ANALYTICS_USER_KEY), null);
    assert.deepEqual(f.sent, []);
  }
  const f = fixture(),
    a = f.create();
  a.start({});
  a.track("App Opened");
  await settle();
  f.storage.setItem(OPT_OUT_KEY, "1");
  f.storageEvent(OPT_OUT_KEY);
  await f.flush();
  assert.equal(f.sent.length, 0);
  a.setOptOut(false);
  await f.flush();
  assert.equal(f.sent.length, 0);
  a.track("Seat Taken");
  await f.flush();
  assert.equal(f.sent.flat()[0]?.name, "fuse.Seat Taken");
});
test("outbox and property bags are bounded and malformed persisted queues recover", async () => {
  const f = fixture();
  f.storage.setItem(ANALYTICS_QUEUE_KEY, '{"broken":true}');
  const a = f.create();
  a.start({});
  for (let i = 0; i < MAX_QUEUED_EVENTS + 25; i++)
    a.track(
      "Tick",
      Object.fromEntries(
        Array.from({ length: 50 }, (_, n) => [
          `field${n}`,
          "ordinary text ".repeat(40),
        ]),
      ),
    );
  await settle();
  const queue: TelemetryEvent[] = JSON.parse(
    f.storage.getItem(ANALYTICS_QUEUE_KEY)!,
  );
  assert.equal(queue.length, MAX_QUEUED_EVENTS);
  assert.equal(Object.keys(queue[0]!.properties).length, 24);
  assert.equal(String(queue[0]!.properties.field0).length, 160);
  await f.flush();
  assert.equal(f.sent[0]!.length, 10);
});
test("round participation deduplicates reload and rollback; no names or local scopes enter transport", async () => {
  const f = fixture();
  const a = f.create();
  a.start({});
  const round = createPlayMetrics(a.track, () => 0);
  round({ ...playing, matchId: "secret-local-match", roundActive: true });
  round({ ...playing, matchId: "secret-local-match", roundActive: true });
  await f.flush();
  const b = f.create();
  b.start({});
  const reload = createPlayMetrics(b.track, () => 0);
  reload({ ...playing, matchId: "secret-local-match", roundActive: true });
  reload({
    ...playing,
    matchId: "secret-local-match",
    roundActive: false,
    roundEnded: true,
  });
  reload({ ...playing, matchId: "secret-local-match", roundActive: true });
  await f.flush();
  assert.equal(
    f.sent.flat().filter((event) => event.name === "fuse.Round Started").length,
    1,
  );
  assert.equal(
    f.sent.flat().filter((event) => event.name === "fuse.Round Ended").length,
    1,
  );
  assert.equal(JSON.stringify(f.sent).includes("secret-local-match"), false);
  const observer = createPlayMetrics(b.track, () => 0);
  observer({
    ...playing,
    matchId: "spectator",
    seated: false,
    roundActive: true,
    roundEnded: true,
  });
  const missed = createPlayMetrics(b.track, () => 0);
  missed({ ...playing, matchId: "never-started", roundEnded: true });
  await f.flush();
  assert.equal(
    f.sent.flat().filter((event) => event.name === "fuse.Round Ended").length,
    1,
  );
});
test("graphics and boot diagnostics preserve role and scrub error messages", async () => {
  const f = fixture(),
    a = f.create();
  a.start({ role: "joiner" });
  a.reportGraphics({ kind: "ready", renderer: "webgl" });
  a.reportBootFailure(new Error("AB42 https://example.com/?room=AB42"));
  a.track("Seat Taken");
  await f.flush();
  const events = f.sent.flat();
  assert.equal(events[0]!.properties.renderer, "webgl");
  assert.equal(events[1]!.properties.role, "boot");
  assert.equal(events[2]!.properties.role, "joiner");
  assert.equal(JSON.stringify(events).includes("AB42"), false);
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
