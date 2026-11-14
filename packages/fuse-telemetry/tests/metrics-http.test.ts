import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { RoomError } from "fuse-network-be";
import { createMetricsHttp } from "../src/metrics-http.js";
import { MetricsStore } from "../src/metrics.js";
import { MemoryTelemetryDatabase } from "../src/metrics-memory.js";
import { SharedTelemetryQuota } from "../src/limits.js";

test("HTTP requires developer authentication for reads and bounds anonymous ingestion", async (context) => {
  const now = Date.parse("2026-11-14T12:00:00Z"),
    db = new MemoryTelemetryDatabase();
  const metrics = new MetricsStore(
    db,
    ["riders"],
    new SharedTelemetryQuota(
      db,
      "test-only-key-longer-than-32-bytes",
      () => now,
    ),
    () => now,
  );
  const http = createMetricsHttp({
    metrics,
    developer: async (token) =>
      token === "verified"
        ? { uid: "dev", email: "dev@example.org" }
        : undefined,
  });
  const server = createServer((req, res) => {
    void http
      .handle(req, res, "127.0.0.1")
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch((error: unknown) => {
        res.writeHead(error instanceof RoomError ? error.status : 500);
        res.end();
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const query = "/api/dev/metrics?period=day&from=2026-11-14&to=2026-11-14";
  assert.equal((await fetch(base + query)).status, 401);
  assert.equal(
    (await fetch(base + query, { headers: { Authorization: "Bearer forged" } }))
      .status,
    403,
  );
  const headers = { Authorization: "Bearer verified" };
  assert.deepEqual(
    await (await fetch(base + "/api/dev/me", { headers })).json(),
    { uid: "dev", email: "dev@example.org" },
  );
  const e = {
    v: 1,
    id: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    gameId: "riders",
    name: "fuse.App Opened",
    occurredAt: now,
    properties: {},
  };
  const post = (body: string, contentType = "application/json") =>
    fetch(base + "/api/telemetry/events", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  const response = await post(JSON.stringify({ events: [e] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { acknowledgedIds: [e.id] });
  assert.equal((await post("{")).status, 400);
  assert.equal((await post("{}", "text/plain")).status, 415);
  assert.equal((await post("x".repeat(65_537))).status, 413);
  assert.equal(
    (await fetch(base + query + "&period=month", { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(base + "/api/dev/metrics?period=year", { headers })).status,
    400,
  );
  assert.equal((await fetch(base + "/api/telemetry/events")).status, 405);
  assert.equal((await fetch(base + "/unknown")).status, 404);
  const result = await (await fetch(base + query, { headers })).json();
  assert.equal(result.series[0].events, 1);
  assert.equal(result.partial, false);
});
