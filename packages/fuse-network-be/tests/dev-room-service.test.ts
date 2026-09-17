import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { connect, type Socket } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createDevRoomService } from "../src/dev.js";
import { RoomGateway } from "../src/gateway.js";
import { createRoomServer } from "../src/http.js";
import { LocalRoomBus, MemoryRoomDatabase } from "../src/memory-database.js";
import { RoomStore, type RoomRecord } from "../src/room-store.js";
import type { RoutedMessage } from "../src/room-bus.js";

const room = (revision: number): RoomRecord => ({
  version: 2,
  code: "AB42",
  incarnation: "one",
  hostHash: "hash",
  hostId: "host",
  expiresAt: 1,
  revision,
  members: {},
});

test("memory database serializes transactions, notifies watchers and hands out private copies", async () => {
  const database = new MemoryRoomDatabase(),
    seen: number[] = [];
  const stop = database.watch("AB42", (current) => {
    seen.push(current!.revision);
  });
  await Promise.all(
    [1, 2, 3].map(() =>
      database.transact("AB42", (current) => ({
        room: room((current?.revision ?? 0) + 1),
        result: undefined,
      })),
    ),
  );
  assert.deepEqual(
    seen,
    [1, 2, 3],
    "concurrent transactions each saw the previous commit",
  );
  const copy = await database.read("AB42");
  copy!.revision = 99;
  assert.equal((await database.read("AB42"))?.revision, 3);
  stop();
  await database.transact("AB42", () => ({ room: room(4), result: undefined }));
  assert.deepEqual(seen, [1, 2, 3], "a stopped watcher is not called");
  assert.equal(await database.read("ZZ99"), undefined);
});

test("memory database keeps serving after a failed transaction", async () => {
  const database = new MemoryRoomDatabase();
  await assert.rejects(
    database.transact("AB42", () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(
    await database.transact("AB42", (current) => ({
      result: current === undefined,
    })),
    true,
  );
});

test("memory database allowance uses the same hourly window as Firestore", async () => {
  const database = new MemoryRoomDatabase();
  for (let index = 0; index < 3; index++)
    assert.equal(await database.allowance("ip", 1_000, 3), true);
  assert.equal(await database.allowance("ip", 2_000, 3), false);
  assert.equal(
    await database.allowance("other", 2_000, 3),
    true,
    "keys are independent",
  );
  assert.equal(
    await database.allowance("ip", 3_600_000, 3),
    true,
    "a new hour resets the count",
  );
});

test("a failing watcher never fails the committed write or starves other watchers", async () => {
  const database = new MemoryRoomDatabase(),
    failures: string[] = [],
    seen: number[] = [];
  database.watch(
    "AB42",
    () => {
      throw new Error("observer broke");
    },
    (error) => {
      failures.push(error.message);
    },
  );
  database.watch("AB42", (current) => {
    seen.push(current!.revision);
  });
  assert.equal(
    await database.transact("AB42", () => ({
      room: room(1),
      result: "committed",
    })),
    "committed",
  );
  assert.deepEqual(failures, ["observer broke"]);
  assert.deepEqual(seen, [1]);
  assert.equal((await database.read("AB42"))?.revision, 1);
});

test("local bus refuses to route beyond its single gateway", async () => {
  const member = {
    id: "a",
    connectionId: "c",
    gatewayId: "elsewhere",
    host: true,
    expiresAt: 1,
  };
  const message: RoutedMessage = {
    id: "m",
    code: "AB42",
    incarnation: "one",
    destination: "elsewhere",
    from: member,
    to: member,
    expiresAt: 1,
    wire: { type: "signal", from: "a", connectionId: "c", data: {} },
  };
  const bus = new LocalRoomBus();
  await bus.start();
  await assert.rejects(bus.publish(message), /single gateway/);
  await bus.stop();
});

interface Reply {
  status: number;
  body: string;
  type: string | undefined;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "fuse-dev-room-")),
    dist = path.join(root, "dist");
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "<main>app shell</main>");
  await writeFile(path.join(dist, "assets", "app.js"), "export {};");
  await writeFile(path.join(root, "secret.txt"), "outside the build");
  const service = createDevRoomService({
    staticDirectory: dist,
    allowedOrigins: ["https://preview.example"],
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`;
  const call = (
    pathname: string,
    options: {
      method?: string;
      origin?: string;
      host?: string;
      authorization?: string;
    } = {},
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const headers: Record<string, string> = {
        host: options.host ?? `127.0.0.1:${port}`,
      };
      if (options.origin) headers.origin = options.origin;
      if (options.authorization) headers.authorization = options.authorization;
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: pathname,
          method: options.method ?? "GET",
          headers,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body,
              type: res.headers["content-type"],
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  const create = async () => {
    const reply = await call("/api/rooms", { method: "POST", origin });
    assert.equal(reply.status, 201, reply.body);
    return JSON.parse(reply.body) as { code: string; token: string };
  };
  const connect = (code: string, token: string, pageOrigin = origin) =>
    new Promise<{ socket: WebSocket; welcome: Record<string, unknown> }>(
      (resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/api/rooms/${code}/ws?token=${token}`,
          { origin: pageOrigin },
        );
        socket.once("message", (raw) =>
          resolve({ socket, welcome: JSON.parse(raw.toString()) }),
        );
        socket.once("unexpected-response", (_req, res) =>
          reject(new Error(`HTTP ${res.statusCode}`)),
        );
        socket.once("error", reject);
      },
    );
  return {
    port,
    origin,
    call,
    create,
    connect,
    close: async () => {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("dev room service creates rooms and admits sockets only for same-origin loopback pages", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    assert.match(code, /^[A-Z]{2}[0-9]{2}$/);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(
      (
        await f.call("/api/rooms", {
          method: "POST",
          origin: `http://localhost:${f.port}`,
          host: `localhost:${f.port}`,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await f.call("/api/rooms", {
          method: "POST",
          origin: "https://preview.example",
        })
      ).status,
      201,
      "configured extra origin",
    );
    assert.equal(
      (
        await f.call("/api/rooms", {
          method: "POST",
          origin: "https://evil.example",
        })
      ).status,
      403,
    );
    // A DNS-rebound page carries a matching Origin and Host, but not a loopback hostname.
    assert.equal(
      (
        await f.call("/api/rooms", {
          method: "POST",
          origin: `http://evil.example:${f.port}`,
          host: `evil.example:${f.port}`,
        })
      ).status,
      403,
    );
    await assert.rejects(
      f.connect(code, token, "https://evil.example"),
      /HTTP 403/,
    );
    const { socket, welcome } = await f.connect(code, token);
    assert.equal(welcome.type, "welcome");
    assert.equal(welcome.protocol, 2);
    const ice = await f.call(`/api/rooms/${code}/ice?token=${token}`, {
      origin: f.origin,
    });
    assert.equal(ice.status, 200);
    assert.equal(JSON.parse(ice.body).relayConfigured, false);
    assert.equal(
      (
        await f.call(`/api/rooms/${code}/ice?token=${"c".repeat(64)}`, {
          origin: f.origin,
        })
      ).status,
      403,
      "ICE needs membership",
    );
    assert.equal(
      (
        await f.call(`/api/rooms/${code}/end`, {
          method: "POST",
          origin: f.origin,
          authorization: `Bearer ${"c".repeat(64)}`,
        })
      ).status,
      403,
      "only the host capability ends a room",
    );
    const closed = new Promise<number>((resolve) =>
      socket.once("close", (code) => resolve(code)),
    );
    assert.equal(
      (
        await f.call(`/api/rooms/${code}/end`, {
          method: "POST",
          origin: f.origin,
          authorization: `Bearer ${token}`,
        })
      ).status,
      200,
    );
    assert.equal(await closed, 4004);
  } finally {
    await f.close();
  }
});

test("dev room service serves the build with app-shell fallback and never outside it", async () => {
  const f = await fixture();
  try {
    const shell = await f.call("/");
    assert.equal(shell.status, 200);
    assert.equal(shell.body, "<main>app shell</main>");
    assert.equal((await f.call("/?room=AB42")).body, "<main>app shell</main>");
    assert.equal(
      (await f.call("/display")).body,
      "<main>app shell</main>",
      "navigations fall back to the app shell",
    );
    const asset = await f.call("/assets/app.js");
    assert.equal(asset.body, "export {};");
    assert.equal(asset.type, "text/javascript");
    assert.equal(
      (await f.call("/assets/missing.js")).status,
      404,
      "a missing asset is not replaced by the shell",
    );
    for (const escape of [
      "/..%2Fsecret.txt",
      "/%2e%2e/secret.txt",
      "/assets/%2e%2e/%2e%2e/secret.txt",
    ]) {
      const reply = await f.call(escape);
      assert.notEqual(reply.body, "outside the build", escape);
    }
    const api = await f.call("/api/unknown");
    assert.equal(api.status, 404);
    assert.deepEqual(JSON.parse(api.body), { error: "Not found" });
    assert.equal(
      (await f.call("/api")).status,
      404,
      "the bare API path is not the app shell",
    );
    assert.equal((await f.call("/api/health")).status, 200);
  } finally {
    await f.close();
  }
});

/** Sends raw bytes and resolves with everything received up to the end of the first HTTP response head. */
function rawExchange(
  port: number,
  text: string,
  keepOpen = false,
): Promise<{ head: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let received = "";
    socket.setEncoding("latin1");
    socket.on("data", (chunk) => {
      received += chunk;
      if (received.includes("\r\n\r\n")) {
        resolve({ head: received, socket });
        if (!keepOpen) socket.destroy();
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve({ head: received, socket }));
    socket.write(text);
  });
}
const upgrade = (port: number, target: string) =>
  `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;

test("an unparsable WebSocket request target is refused without crashing the service", async () => {
  const f = await fixture();
  try {
    const { head } = await rawExchange(f.port, upgrade(f.port, "//["));
    assert.match(head, /^HTTP\/1\.1 403/);
    assert.equal(
      (await f.call("/api/health")).status,
      200,
      "the service is still serving",
    );
  } finally {
    await f.close();
  }
});

test(
  "closing the service does not wait for a WebSocket client that ignores the close handshake",
  { timeout: 5_000 },
  async () => {
    const f = await fixture();
    const { code, token } = await f.create();
    const { head, socket } = await rawExchange(
      f.port,
      upgrade(f.port, `/api/rooms/${code}/ws?token=${token}`),
      true,
    );
    try {
      assert.match(head, /^HTTP\/1\.1 101/);
      // The raw socket never answers a close frame, like a suspended phone tab; ws alone would wait 30 seconds.
      await f.close();
    } finally {
      socket.destroy();
    }
  },
);

test("WebSocket admission failures are throttled before upgrade without spending room-creation allowance", async () => {
  const f = await fixture();
  try {
    const attempt = () =>
      new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${f.port}/api/rooms/ZZ99/ws?token=${"a".repeat(64)}`,
          { origin: f.origin },
        );
        ws.on("error", reject);
        ws.once("close", (code) => resolve(code));
        ws.once("unexpected-response", (_req, response) => {
          response.resume();
          resolve(response.statusCode!);
          ws.terminate();
        });
      });
    for (let i = 0; i < 30; i++) assert.equal(await attempt(), 4004);
    assert.equal(await attempt(), 429);
    assert.equal(await attempt(), 429);
    const room = await f.create();
    assert.match(room.code, /^[A-Z]{2}[0-9]{2}$/);
  } finally {
    await f.close();
  }
});

test("rejected WebSocket handshakes release their pending admission slots", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    for (let i = 0; i < 6; i++) {
      const reply = await rawExchange(
        f.port,
        `GET /api/rooms/${code}/ws?token=${token} HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nOrigin: ${f.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      assert.match(reply.head, /^HTTP\/1.1 400 /);
    }
    const { socket } = await f.connect(code, token);
    socket.close();
  } finally {
    await f.close();
  }
});

test("a route that fails after its response started drops that connection and the service keeps serving", async () => {
  const service = createDevRoomService({
    httpExtension: () => ({
      handle: async (req, res) => {
        if (req.url !== "/api/broken") return false;
        // The error boundary can no longer answer with a status once headers are committed.
        res.writeHead(200, { "Content-Type": "text/plain" });
        throw new Error("failed after the response started");
      },
    }),
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(
      fetch(`${origin}/api/broken`),
      "the unanswerable request is dropped instead of hanging",
    );
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
  } finally {
    await service.close();
  }
});

test("a request that fails before its response started is answered 500 without the error, and the service keeps serving", async () => {
  const now = () => 1_000;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now,
    id: () => "id",
  });
  const gateway = new RoomGateway("test", store, new LocalRoomBus(), {
    now,
    id: () => "id",
    error: () => undefined,
  });
  // The Origin decision runs ahead of the handler's own error boundary.
  const server = createRoomServer({
    store,
    gateway,
    now,
    allowOrigin: (origin) => {
      if (origin === "http://throws.example")
        throw new Error("secret origin failure detail");
      return true;
    },
    clientAddress: () => "test",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const failed = await fetch(`${base}/api/health?token=secret-query`, {
      headers: { Origin: "http://throws.example" },
    });
    assert.equal(failed.status, 500);
    const body = await failed.text();
    assert.deepEqual(JSON.parse(body), { error: "Room service unavailable" });
    assert.doesNotMatch(body, /secret/);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    await gateway.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
