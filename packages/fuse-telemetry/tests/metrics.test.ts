import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { RoomError } from "fuse-network-be";
import type { TelemetryEvent } from "../src/contracts.js";
import {
  SharedTelemetryQuota,
  TelemetryAdmission,
  type QuotaCharge,
} from "../src/limits.js";
import { MemoryTelemetryDatabase } from "../src/metrics-memory.js";
import {
  MetricsStore,
  parseTelemetryEvents,
  periodStart,
} from "../src/metrics.js";
import type { TelemetryDatabase } from "../src/metrics-database.js";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const USER = randomUUID(),
  SESSION = randomUUID();
const secret = "test-only-fixed-rate-key-more-than-32-bytes";
function setup() {
  const db = new MemoryTelemetryDatabase();
  return {
    db,
    store: new MetricsStore(
      db,
      ["riders", "pig"],
      new SharedTelemetryQuota(db, secret, () => NOW),
      () => NOW,
    ),
  };
}
function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    v: 1,
    id: randomUUID(),
    gameId: "riders",
    userId: USER,
    sessionId: SESSION,
    name: "fuse.Round Started",
    occurredAt: NOW,
    properties: {},
    ...overrides,
  };
}
function query(
  period: "day" | "week" | "month" = "day",
  from = "2026-11-14",
  to = "2026-11-14",
) {
  return { period, from, to };
}
test("concurrent retry delivery acknowledges IDs once with atomic rollups", async () => {
  const { store } = setup(),
    e = event();
  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      store.ingest({ events: [e] }, "127.0.0.1"),
    ),
  );
  assert.ok(
    responses.every((response) => response.acknowledgedIds[0] === e.id),
  );
  const metrics = await store.metrics(query());
  assert.equal(metrics.series[0]?.events, 1);
  assert.equal(metrics.series[0]?.roundStarts, 1);
  assert.equal(metrics.series[0]?.users, 1);
  assert.equal(metrics.series[0]?.sessions, 1);
  assert.equal(metrics.games.find((row) => row.gameId === "pig")?.events, 0);
});
test("custom-name saturation cannot block lifecycle events in any global shard", async () => {
  const { store, db } = setup();
  const sessions = Array.from({ length: 8 }, () => randomUUID());
  const custom: TelemetryEvent[][] = Array.from({ length: 8 }, () => []);
  const lifecycle: TelemetryEvent[][] = Array.from({ length: 8 }, () => []);
  const names = [
    "fuse.App Opened",
    "fuse.Seat Taken",
    "fuse.Match Started",
    "fuse.Match Ended",
    "fuse.Round Started",
    "fuse.Round Ended",
  ];
  for (
    let sequence = 0;
    lifecycle.some((events) => events.length < names.length);
    sequence++
  ) {
    const id = `${sequence.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
    const shard =
      Number.parseInt(
        createHash("sha256").update(id).digest("hex").slice(0, 8),
        16,
      ) % 8;
    const events = custom[shard]!;
    if (events.length < 128)
      events.push(
        event({
          id,
          sessionId: sessions[shard]!,
          name: `fuse.Custom ${events.length}`,
        }),
      );
    else if (lifecycle[shard]!.length < names.length)
      lifecycle[shard]!.push(
        event({
          id,
          sessionId: sessions[shard]!,
          gameId: "pig",
          name: names[lifecycle[shard]!.length]!,
        }),
      );
  }
  const customEvents = custom.flat(),
    coreEvents = lifecycle.flat();
  for (let offset = 0; offset < customEvents.length; offset += 50)
    await store.ingest(
      { events: customEvents.slice(offset, offset + 50) },
      "127.0.0.1",
    );
  for (let retry = 0; retry < 2; retry++)
    assert.deepEqual(
      (await store.ingest({ events: coreEvents }, "127.0.0.1")).acknowledgedIds,
      coreEvents.map(({ id }) => id),
    );
  for (const period of ["day", "week", "month"] as const) {
    const metrics = await store.metrics(query(period));
    const totals = metrics.series[0]!;
    assert.equal(totals.events, customEvents.length + coreEvents.length);
    assert.equal(totals.roundStarts, 8);
    assert.equal(totals.roundEnds, 8);
    for (const name of names) assert.equal(totals.eventCounts[name], 8);
    assert.equal(totals.eventCounts.__other__, 56);
    assert.equal(
      Object.values(totals.eventCounts).reduce((sum, count) => sum + count, 0),
      totals.events,
    );
    assert.equal(
      metrics.games.find(({ gameId }) => gameId === "pig")?.events,
      coreEvents.length,
    );
    const start = new Date(periodStart(NOW, period)).toISOString().slice(0, 10);
    const shards = await db.readMany(
      Array.from(
        { length: 8 },
        (_, shard) => `telemetry-rollups/${period}-${start}-all-${shard}`,
      ),
    );
    for (const shard of shards) {
      assert.ok(shard && typeof shard === "object" && "eventCounts" in shard);
      assert.ok(shard.eventCounts && typeof shard.eventCounts === "object");
      assert.equal(Object.keys(shard.eventCounts).length, 128);
    }
  }
});
test("legacy saturated summaries compact unknown names without losing totals", async () => {
  const { store, db } = setup();
  const counts = Object.fromEntries(
    Array.from({ length: 128 }, (_, i) => [`fuse.Custom ${i}`, 2]),
  );
  await db.transact(async (tx) => {
    for (let shard = 0; shard < 8; shard++)
      tx.set(`telemetry-rollups/day-2026-11-14-all-${shard}`, {
        events: 256,
        users: 0,
        sessions: 0,
        roundStarts: 0,
        roundEnds: 0,
        eventCounts: counts,
      });
  });
  const e = event();
  await store.ingest({ events: [e] }, "127.0.0.1");
  await store.ingest({ events: [e] }, "127.0.0.1");
  const totals = (await store.metrics(query())).series[0]!;
  assert.equal(totals.events, 2049);
  assert.equal(totals.roundStarts, 1);
  assert.equal(totals.eventCounts["fuse.Round Started"], 1);
  assert.equal(totals.eventCounts.__other__, 112);
  assert.equal(
    Object.values(totals.eventCounts).reduce((sum, count) => sum + count, 0),
    totals.events,
  );
});
test("weekly and monthly memberships deduplicate across days and games", async () => {
  const { store } = setup();
  const events = [
    event({ occurredAt: Date.parse("2026-11-12T01:00:00Z") }),
    event({ occurredAt: Date.parse("2026-11-13T01:00:00Z"), gameId: "pig" }),
    event({
      occurredAt: Date.parse("2026-11-14T01:00:00Z"),
      name: "fuse.Round Ended",
    }),
  ];
  await store.ingest({ events }, "127.0.0.1");
  const days = await store.metrics(query("day", "2026-11-12", "2026-11-14"));
  assert.equal(
    days.series.reduce((sum, row) => sum + row.users, 0),
    3,
  );
  for (const period of ["week", "month"] as const) {
    const response = await store.metrics(
      query(period, "2026-11-12", "2026-11-14"),
    );
    assert.equal(response.series.length, 1);
    assert.equal(response.series[0]?.users, 1);
    assert.equal(response.series[0]?.sessions, 1);
    assert.equal(response.series[0]?.events, 3);
    assert.equal(response.series[0]?.roundStarts, 2);
    assert.equal(response.series[0]?.roundEnds, 1);
    assert.equal(
      response.games.reduce((sum, row) => sum + row.users, 0),
      2,
    );
  }
});
test("distinct users and sessions remain exact across event shards and calendar boundaries", async () => {
  const { store } = setup(),
    otherUser = randomUUID(),
    otherSession = randomUUID();
  await store.ingest(
    {
      events: [
        event({ occurredAt: Date.parse("2026-10-31T23:59:59Z") }),
        event({ occurredAt: Date.parse("2026-11-01T00:00:00Z") }),
        event({ userId: otherUser, sessionId: otherSession }),
        event({ userId: otherUser, sessionId: SESSION }),
      ],
    },
    "127.0.0.1",
  );
  const response = await store.metrics(
    query("month", "2026-10-31", "2026-11-14"),
  );
  assert.equal(response.from, "2026-10-01");
  assert.equal(response.toExclusive, "2026-12-01");
  assert.deepEqual(
    response.series.map((row) => [row.users, row.sessions, row.events]),
    [
      [1, 1, 1],
      [2, 2, 3],
    ],
  );
  assert.equal(
    new Date(
      periodStart(Date.parse("2027-01-01T12:00:00Z"), "week"),
    ).toISOString(),
    "2026-12-28T00:00:00.000Z",
  );
});
test("a reused event ID with different content is rejected without changing aggregates", async () => {
  const { store } = setup(),
    e = event();
  await store.ingest({ events: [e] }, "127.0.0.1");
  await assert.rejects(
    store.ingest({ events: [{ ...e, gameId: "pig" }] }, "127.0.0.1"),
    (error: unknown) => error instanceof RoomError && error.status === 409,
  );
  assert.equal((await store.metrics(query())).series[0]?.events, 1);
});
test("malformed full batch rejects before any event is accepted", async () => {
  const { store } = setup();
  await assert.rejects(
    store.ingest(
      { events: [event(), { ...event(), properties: { nested: [] } }] },
      "127.0.0.1",
    ),
  );
  assert.equal((await store.metrics(query())).series[0]?.events, 0);
  for (const bad of [
    { events: [] },
    { events: Array.from({ length: 51 }, () => event()) },
    { events: [event({ gameId: "unknown" })] },
    { events: [event({ name: "game.Round Started" })] },
    { events: [event({ occurredAt: NOW + 300_001 })] },
    { events: [event({ occurredAt: NOW - 91 * 86_400_000 })] },
    { events: [event({ userId: "email@example.org" })] },
    { events: [event({ properties: { value: "x".repeat(201) } })] },
  ])
    assert.throws(() => parseTelemetryEvents(bad, new Set(["riders"]), NOW));
});
test("server drops private properties and scrubs bearer credentials and invitations", async () => {
  const { store, db } = setup(),
    e = event({
      properties: {
        player_name: "Alice",
        roomCode: "AB42",
        email: "x@example.org",
        token: "secret",
        matchId: randomUUID(),
        error:
          "Failed https://example.org/?room=AB42 token=secret x@example.org",
        phase: "playing",
        score: 3,
      },
    });
  await store.ingest({ events: [e] }, "127.0.0.1");
  const stored = (await db.readMany([`telemetry-events/${e.id}`]))[0];
  assert.ok(stored && typeof stored === "object" && "properties" in stored);
  assert.deepEqual(stored.properties, {
    error: "Failed [url] token=[redacted] [email]",
    phase: "playing",
    score: 3,
  });
});
test("queries expose explicit errors for bad dates, retention, unknown games and oversized ranges", async () => {
  const { store } = setup();
  for (const bad of [
    query("day", "2026-02-30"),
    query("day", "2026-11-14", "2026-11-13"),
    query("day", "2025-01-01"),
    query("day", "2026-08-01"),
    { ...query(), gameId: "unknown" },
    query("day", "2026-11-14", "2026-11-15"),
  ])
    await assert.rejects(store.metrics(bad), RoomError);
  const wide = new MetricsStore(
    new MemoryTelemetryDatabase(),
    Array.from({ length: 100 }, (_, i) => `game-${i}`),
    { consume: async () => {} },
    () => NOW,
  );
  await assert.rejects(
    wide.metrics(query("day", "2026-10-01")),
    (error: unknown) =>
      error instanceof RoomError &&
      error.status === 422 &&
      error.message.includes("documents"),
  );
});
test("shared quotas reject atomically and normalize mapped IPs", async () => {
  const db = new MemoryTelemetryDatabase();
  const a = new SharedTelemetryQuota(db, secret, () => NOW),
    b = new SharedTelemetryQuota(db, secret, () => NOW);
  const charge = {
    dimension: "test",
    identity: "one",
    cost: 1,
    limit: 1,
    windowMs: 60_000,
  };
  const settled = await Promise.allSettled([
    a.consume([charge]),
    b.consume([charge]),
  ]);
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(a.consume([{ ...charge, identity: "new" }, charge]));
  await a.consume([{ ...charge, identity: "new" }]);
  assert.throws(() => new SharedTelemetryQuota(db, "short"));
  const captured: QuotaCharge[][] = [];
  const store = new MetricsStore(
    db,
    ["riders"],
    {
      consume: async (charges) => {
        captured.push([...charges]);
      },
    },
    () => NOW,
  );
  await store.ingest({ events: [event()] }, "127.0.0.1");
  await store.ingest({ events: [event()] }, "::ffff:127.0.0.1");
  assert.equal(captured[0]?.[0]?.identity, captured[1]?.[0]?.identity);
});
test("memory transactions discard rejected writes and preadmission releases capacity on failure", async () => {
  const db = new MemoryTelemetryDatabase();
  await assert.rejects(
    db.transact(async (tx) => {
      tx.set("telemetry-events/test", { bad: true });
      throw new Error("stop");
    }),
  );
  assert.deepEqual(await db.readMany(["telemetry-events/test"]), [undefined]);
  const gate = new TelemetryAdmission(() => NOW);
  await assert.rejects(
    gate.run("127.0.0.1", async () => {
      throw new Error("failed");
    }),
  );
  assert.equal(await gate.run("127.0.0.1", async () => "ok"), "ok");
});
test("an interrupted partial batch recovers through stable IDs without counting accepted events twice", async () => {
  const db = new MemoryTelemetryDatabase();
  let transactions = 0,
    fail = true;
  const interrupt: TelemetryDatabase = {
    readMany: (keys) => db.readMany(keys),
    transact: (operation) => {
      transactions++;
      if (transactions === 2 && fail) {
        fail = false;
        return Promise.reject(new Error("temporarily offline"));
      }
      return db.transact(operation);
    },
  };
  const store = new MetricsStore(
    interrupt,
    ["riders"],
    { consume: async () => {} },
    () => NOW,
  );
  const events = [event(), event()];
  await assert.rejects(store.ingest({ events }, "127.0.0.1"), /offline/);
  assert.equal((await store.metrics(query())).series[0]?.events, 1);
  assert.deepEqual(
    (await store.ingest({ events }, "127.0.0.1")).acknowledgedIds,
    events.map((e) => e.id),
  );
  assert.equal((await store.metrics(query())).series[0]?.events, 2);
});
test("corrupt aggregates reject event installation atomically rather than silently discarding prior counts", async () => {
  const { store, db } = setup();
  await db.transact(async (tx) => {
    for (let i = 0; i < 8; i++)
      tx.set(`telemetry-rollups/day-2026-11-14-all-${i}`, {
        events: -1,
        eventCounts: {},
      });
  });
  const e = event();
  await assert.rejects(
    store.ingest({ events: [e] }, "127.0.0.1"),
    /incompatible/,
  );
  assert.deepEqual(await db.readMany([`telemetry-events/${e.id}`]), [
    undefined,
  ]);
});
test("the cheap admission gate bounds concurrent requests per normalized address", async () => {
  const gate = new TelemetryAdmission(() => NOW);
  const releases: Array<() => void> = [];
  const active = Array.from({ length: 4 }, () =>
    gate.run(
      "127.0.0.1",
      () => new Promise<void>((resolve) => releases.push(resolve)),
    ),
  );
  await assert.rejects(
    gate.run("::ffff:127.0.0.1", async () => {}),
    (error: unknown) => error instanceof RoomError && error.status === 429,
  );
  for (const release of releases) release();
  await Promise.all(active);
  assert.equal(await gate.run("127.0.0.1", async () => "released"), "released");
});
