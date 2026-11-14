import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { RoomError } from "fuse-network-be";
import { composeHttp } from "fuse-platform";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "fuse-telemetry/debug-memory";
import { MemoryActionDatabase } from "fuse-telemetry/action-adapters";
import {
  TranscriptionWorker,
  transcriptionWorkerHttp,
} from "fuse-telemetry/worker";
import { pcmWav } from "../packages/fuse-ui/src/playtest-audio.js";
import {
  createTelemetryServices,
  telemetryUnavailable,
} from "../service/telemetry.js";

test("actual HTTP joins anonymous metrics/reports, admin audio, durable extraction and scoped work claims", async (t) => {
  const now = Date.UTC(2026, 10, 14, 12);
  const objects = new MemoryPrivateObjectStorage();
  const services = createTelemetryServices({
    gameIds: ["dice"],
    now: () => now,
    developer: async (token) =>
      token === "test-admin"
        ? { uid: "admin", email: "andersullnass@gmail.com" }
        : undefined,
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase: new MemoryDebugDatabase(),
    actionDatabase: new MemoryActionDatabase(),
    objects,
    recordingEnabled: true,
    rateLimitKey: "integration-only-rate-key-32-bytes-never-a-secret",
    extractor: {
      async extract(input) {
        return [
          {
            kind: "propose",
            targetId: null,
            title: "Fix the stuck menu",
            detail: "Fix the menu after rolling.",
            evidence: [
              { sequence: input.currentSequence, quote: "Fix the stuck menu." },
            ],
          },
        ];
      },
    },
  });
  let providerCalls = 0;
  const worker = new TranscriptionWorker({
    service: services.debug,
    bucket: "local-test",
    transcriber: {
      async transcribe() {
        providerCalls++;
        return "Fix the stuck menu.";
      },
    },
    afterTranscript: (input) => services.actions.process(input),
  });
  const workerHttp = transcriptionWorkerHttp(
    worker,
    async (req) => req.headers.authorization === "Bearer test-worker",
  );
  const routes = composeHttp(
    { handle: (req, res) => workerHttp(req, res) },
    services.http,
  );
  const server = createServer((req, res) => {
    void routes
      .handle(req, res, "127.0.0.1")
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch((error: unknown) => {
        res.writeHead(error instanceof RoomError ? error.status : 500, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: error instanceof RoomError ? error.message : "Server error",
          }),
        );
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body?: unknown, token?: string) =>
    fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request("/api/dev/me")).status, 401);
  assert.equal(
    (await request("/api/dev/me", undefined, "outsider")).status,
    403,
  );
  const userId = randomUUID(),
    sessionId = randomUUID(),
    eventId = randomUUID();
  const batch = {
    events: [
      {
        v: 1,
        id: eventId,
        gameId: "dice",
        userId,
        sessionId,
        name: "fuse.Round Started",
        occurredAt: now,
        properties: {},
      },
    ],
  };
  assert.equal((await request("/api/telemetry/events", batch)).status, 200);
  assert.equal((await request("/api/telemetry/events", batch)).status, 200);
  const metrics = await (
    await request(
      "/api/dev/metrics?period=day&from=2026-11-14&to=2026-11-14",
      undefined,
      "test-admin",
    )
  ).json();
  assert.equal(metrics.series[0].events, 1);
  assert.equal(metrics.series[0].roundStarts, 1);
  const recordingId = randomUUID();
  const recording = { id: recordingId, gameId: "dice", startedAt: now };
  assert.equal(
    (await request("/api/telemetry/recordings", recording)).status,
    401,
  );
  assert.equal(
    (await request("/api/telemetry/recordings", recording, "outsider")).status,
    403,
  );
  assert.equal(
    (await request("/api/telemetry/recordings", recording, "test-admin"))
      .status,
    200,
  );
  const audio = pcmWav(new Float32Array(8000), 8000);
  const upload = await fetch(
    `${origin}/api/telemetry/recordings/${recordingId}/segments/0`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer test-admin",
        "content-type": "audio/wav",
        "X-Recording-Start-Ms": "0",
        "X-Recording-Game-Id": "dice",
      },
      body: audio,
    },
  );
  assert.equal(upload.status, 200);
  const reportId = randomUUID();
  assert.equal(
    (
      await request(
        "/api/telemetry/reports",
        {
          id: reportId,
          gameId: "dice",
          category: "bug",
          text: "The menu is stuck.",
          createdAt: now,
          recordingId,
          offsetMs: 500,
        },
        "test-admin",
      )
    ).status,
    200,
  );
  const name = `recordings/${recordingId}/0.wav`,
    saved = await objects.get(name);
  assert.ok(saved);
  const delivery = {
    message: {
      data: Buffer.from(
        JSON.stringify({
          bucket: "local-test",
          name,
          generation: saved.generation,
        }),
      ).toString("base64"),
    },
  };
  assert.equal(
    (await request("/api/internal/transcription", delivery, "test-admin"))
      .status,
    401,
  );
  assert.equal(
    (await request("/api/internal/transcription", delivery, "test-worker"))
      .status,
    204,
  );
  assert.equal(
    (await request("/api/internal/transcription", delivery, "test-worker"))
      .status,
    204,
  );
  assert.equal(providerCalls, 1);
  const detail = await (
    await request(`/api/dev/recordings/${recordingId}`, undefined, "test-admin")
  ).json();
  assert.match(detail.transcript, /Fix the stuck menu/);
  assert.equal(detail.reports[0].id, reportId);
  const credential = await (
    await request("/api/dev/agent-tokens", { recordingId }, "test-admin")
  ).json();
  assert.equal(
    (
      await request(
        "/api/telemetry/recordings",
        { ...recording, id: randomUUID() },
        credential.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/dev/recordings/${recordingId}`,
        undefined,
        credential.token,
      )
    ).status,
    403,
  );
  const queue = await (
    await request("/api/dev/actions", undefined, credential.token)
  ).json();
  assert.equal(queue.actions.length, 1);
  assert.deepEqual(queue.actions[0].evidence[0].reportIds, [reportId]);
  const claimed = await (
    await request(
      `/api/dev/actions/${queue.actions[0].id}/claim`,
      { agentName: "integration" },
      credential.token,
    )
  ).json();
  assert.equal(claimed.action.status, "claimed");
  assert.equal(typeof claimed.token, "string");
  const completed = await request(
    `/api/dev/actions/${queue.actions[0].id}/complete`,
    { token: claimed.token, note: "Fixed and regression verified in test PR." },
    credential.token,
  );
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).status, "done");
});

test("unconfigured production telemetry fails closed without intercepting game routes", async () => {
  const { IncomingMessage, ServerResponse } = await import("node:http");
  const { Socket } = await import("node:net");
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);
  req.url = "/api/rooms";
  assert.equal(await telemetryUnavailable.handle(req, res, "local"), false);
  req.url = "/api/dev/metrics";
  await assert.rejects(
    telemetryUnavailable.handle(req, res, "local"),
    /not configured/,
  );
});

test("report links use the segment range beyond the first report page and cap evidence without losing session reports", async () => {
  const now = Date.UTC(2026, 10, 14, 12),
    recordingId = randomUUID();
  const database = new MemoryDebugDatabase(),
    objects = new MemoryPrivateObjectStorage();
  const services = createTelemetryServices({
    gameIds: ["dice"],
    now: () => now,
    developer: async () => undefined,
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase: database,
    actionDatabase: new MemoryActionDatabase(),
    objects,
    rateLimitKey: "integration-only-rate-key-32-bytes-never-a-secret",
    extractor: {
      async extract() {
        return [
          {
            kind: "propose",
            targetId: null,
            title: "Fix the stuck menu",
            detail: "Repair the menu.",
            evidence: [{ sequence: 0, quote: "Fix the stuck menu." }],
          },
        ];
      },
    },
  });
  await services.debug.createRecording("admin", {
    id: recordingId,
    gameId: "dice",
    startedAt: now,
  });
  await services.debug.upload(
    "admin",
    recordingId,
    0,
    0,
    new Uint8Array(await pcmWav(new Float32Array(8000), 8000).arrayBuffer()),
    "dice",
  );
  const linkedIds: string[] = [];
  for (let i = 0; i < 74; i++) {
    const current = i >= 51,
      id = `${current ? "ffffffff" : "00000000"}-0000-4000-8000-${String(i).padStart(12, "0")}`;
    await services.debug.submitReport(`identity-${i}`, "admin", {
      id,
      recordingId,
      offsetMs: current ? 500 : 10000,
      gameId: "dice",
      category: "bug",
      text: "The menu is stuck.",
      createdAt: now,
    });
    if (current) linkedIds.push(id);
  }
  // Unfinished screenshot reservations and expired metadata must not consume the link budget.
  for (const [index, changes] of [
    { ready: false },
    { expiresAt: now },
  ].entries()) {
    const key = `report:${linkedIds[index]}`;
    await database.transact([key], (records) => {
      const record = records.get(key);
      assert.ok(record);
      return {
        writes: new Map([[key, { ...record, ...changes }]]),
        result: undefined,
      };
    });
  }
  const worker = new TranscriptionWorker({
    service: services.debug,
    bucket: "local-test",
    transcriber: {
      async transcribe() {
        return "Fix the stuck menu.";
      },
    },
    afterTranscript: (input) => services.actions.process(input),
  });
  const name = `recordings/${recordingId}/0.wav`,
    saved = await objects.get(name);
  assert.ok(saved);
  await worker.process({
    bucket: "local-test",
    name,
    generation: saved.generation,
  });
  const actions = await services.actions.list(
    { recordingId },
    { uid: "admin" },
  );
  assert.deepEqual(
    actions.actions[0]!.evidence[0]!.reportIds,
    linkedIds.slice(2, 22),
  );
  const page = await services.debug.listReports(50, undefined, recordingId);
  assert.ok(page.nextCursor);
  const later = await services.debug.listReports(
    50,
    page.nextCursor,
    recordingId,
  );
  assert.equal(page.reports.length + later.reports.length, 72);
});
