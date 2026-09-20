import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { runPublicSmoke } from "../scripts/cloud-public-smoke.js";
import {
  LocalRoomBus,
  MemoryRoomDatabase,
  RoomGateway,
  RoomStore,
  authToken,
  validToken,
} from "fuse-network-be";
async function fixture(brokenCors = false) {
  const database = new MemoryRoomDatabase(),
    store = new RoomStore(database, { now: Date.now, id: randomUUID });
  const gateway = new RoomGateway("test", store, new LocalRoomBus(), {
    now: Date.now,
    id: randomUUID,
    error: () => {},
  });
  const browserOrigin = "https://andeplane.github.io";
  // A rejection in this fixture should fail the test as node:test's unhandled rejection, not be answered.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture");
    if (req.headers.origin !== browserOrigin) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!brokenCors)
      res.setHeader("Access-Control-Allow-Origin", browserOrigin);
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/api/health" || url.pathname === "/api/ready") {
      res.end('{"ok":true}');
      return;
    }
    if (url.pathname === "/api/rooms") {
      const token = randomBytes(32).toString("hex"),
        code = await store.createAvailable(token);
      res.writeHead(201);
      res.end(JSON.stringify({ code, token }));
      return;
    }
    if (url.pathname.endsWith("/end")) {
      try {
        await store.end(
          url.pathname.split("/")[3]!,
          req.headers.authorization?.replace(/^Bearer /, "") ?? "",
        );
        res.end('{"ok":true}');
      } catch (error) {
        res.writeHead((error as { status: number }).status ?? 503);
        res.end();
      }
      return;
    }
    if (url.pathname.endsWith("/ice")) {
      if (
        !validToken(req.headers.authorization?.replace(/^Bearer /, "") ?? "")
      ) {
        res.writeHead(401);
        res.end();
      } else res.end('{"relayConfigured":false}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url!, "http://fixture");
    sockets.handleUpgrade(req, socket, head, (ws) => {
      let id: string | undefined,
        authenticated = false;
      const pending: string[] = [];
      ws.on("message", (raw, binary) => {
        if (id) void gateway.receive(id, raw.toString());
        else if (authenticated) pending.push(raw.toString());
        else {
          // The first frame is the credential; the request URL carries none.
          const token = authToken(raw.toString(), binary);
          if (!token) {
            ws.close(4401, "Authentication required");
            return;
          }
          authenticated = true;
          void gateway
            .connect(url.pathname.split("/")[3]!, token, ws)
            .then((value) => {
              id = value;
              for (const frame of pending) void gateway.receive(id, frame);
            });
        }
      });
      ws.on("close", () => {
        if (id) void gateway.disconnect(id);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await gateway.stop();
      sockets.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
test("public smoke exercises real gateway socket boundaries and emits no credentials", async () => {
  const f = await fixture();
  try {
    const report = await runPublicSmoke({
      origin: f.origin,
      allowLoopback: true,
      timeoutMs: 1000,
    });
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.ok(report.checks.some((c) => c.name.includes("replacement")));
    assert.doesNotMatch(
      JSON.stringify(report),
      /[a-f0-9]{64}|token=|api\/rooms\/[A-Z]{2}[0-9]{2}/,
    );
  } finally {
    await f.close();
  }
});
test("public smoke stops on broken CORS and reports only a safe check label", async () => {
  const f = await fixture(true);
  try {
    const report = await runPublicSmoke({
      origin: f.origin,
      allowLoopback: true,
      timeoutMs: 1000,
    });
    assert.equal(report.passed, false);
    assert.match(report.failedCheck!, /CORS/);
    assert.equal(report.errorType, "AssertionError");
  } finally {
    await f.close();
  }
});
test("public smoke rejects plaintext and credential-bearing production origins before requests", async () => {
  await assert.rejects(runPublicSmoke({ origin: "http://example.com" }));
  await assert.rejects(
    runPublicSmoke({ origin: "https://user:password@example.com" }),
  );
  await assert.rejects(
    runPublicSmoke({ origin: "https://example.com/private" }),
  );
});
