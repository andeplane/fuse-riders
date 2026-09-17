import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { WebSocket } from "ws";
import { createGameServer } from "../src/server/index.js";
import { allowLanOrigin } from "../src/server/lan-origin.js";
import {
  LanSendGate,
  MAX_BUFFERED_BYTES,
  SLOW_CLIENT_MS,
  SLOW_CLOSE_GRACE_MS,
  type SendSocket,
} from "../src/server/send-gate.js";

class Socket implements SendSocket {
  readyState = 1;
  bufferedAmount = 0;
  closes: { code: number; reason: string }[] = [];
  terminated = false;
  close(code: number, reason: string) {
    this.closes.push({ code, reason });
    this.readyState = 2;
  }
  terminate() {
    this.terminated = true;
    this.readyState = 3;
  }
}
test("LAN send gate tolerates brief congestion, resets after drain and closes only sustained slow clients", () => {
  let now = 0;
  const gate = new LanSendGate(() => now),
    slow = new Socket(),
    healthy = new Socket();
  assert.equal(gate.writable(slow), true);
  slow.bufferedAmount = MAX_BUFFERED_BYTES + 1;
  assert.equal(gate.writable(slow), false);
  now = SLOW_CLIENT_MS - 1;
  assert.equal(gate.writable(slow), false);
  assert.equal(slow.closes.length, 0);
  slow.bufferedAmount = 0;
  assert.equal(gate.writable(slow), true);
  slow.bufferedAmount = MAX_BUFFERED_BYTES + 1;
  assert.equal(gate.writable(slow), false);
  now += SLOW_CLIENT_MS - 1;
  assert.equal(gate.writable(slow), false);
  assert.equal(slow.closes.length, 0);
  now++;
  assert.equal(gate.writable(slow), false);
  assert.equal(slow.closes[0]?.code, 1013);
  assert.equal(gate.writable(healthy), true);
  assert.equal(healthy.closes.length, 0);
  now += SLOW_CLOSE_GRACE_MS - 1;
  gate.writable(slow);
  assert.equal(slow.terminated, false);
  now++;
  gate.writable(slow);
  assert.equal(slow.terminated, true);
  assert.equal(gate.writable(slow), false);
});

test("LAN origin validation recognizes local addresses and rejects cross-origin and rebinding hosts", () => {
  const local = [
    "localhost",
    "127.0.0.1",
    "192.168.1.42",
    "::ffff:192.168.1.43",
    "::1",
    "my-mac.local",
  ];
  for (const host of [
    "localhost:3000",
    "127.0.0.1:3000",
    "192.168.1.42:3000",
    "192.168.1.43:3000",
    "[::1]:3000",
    "my-mac.local:3000",
  ])
    assert.equal(allowLanOrigin(`http://${host}`, host, local), true);
  for (const origin of [
    undefined,
    "null",
    "https://evil.example",
    "http://localhost:3001",
    "http://localhost:3000/path",
  ])
    assert.equal(allowLanOrigin(origin, "localhost:3000", local), false);
  assert.equal(
    allowLanOrigin("http://evil.example:3000", "evil.example:3000", local),
    false,
  );
  assert.equal(
    allowLanOrigin("http://localhost:3000", undefined, local),
    false,
  );
  assert.equal(
    allowLanOrigin("http://localhost:3000", "[invalid", local),
    false,
  );
});

test("LAN WebSocket upgrades reject missing or foreign Origin while same-origin peers still connect", async () => {
  const app = await createGameServer({
    port: 0,
    hostname: "127.0.0.1",
    manualTicks: true,
  });
  try {
    const denied = (origin?: string, host?: string) =>
      new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, {
          ...(origin ? { origin } : {}),
          ...(host ? { headers: { Host: host } } : {}),
        });
        ws.once("error", reject);
        ws.once("unexpected-response", (_req, res) => {
          res.resume();
          resolve(res.statusCode!);
          ws.terminate();
        });
      });
    assert.equal(await denied(), 403);
    assert.equal(await denied("https://evil.example"), 403);
    assert.equal(
      await denied(
        `http://evil.example:${app.port}`,
        `evil.example:${app.port}`,
      ),
      403,
    );
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, {
      origin: `http://localhost:${app.port}`,
      headers: { Host: `localhost:${app.port}` },
    });
    const welcome = once(ws, "message");
    await once(ws, "open");
    await welcome;
    ws.terminate();
  } finally {
    await app.close();
  }
});

test("production LAN server refuses telemetry POSTs before reading or appending payloads", async () => {
  const app = await createGameServer({
    port: 0,
    hostname: "127.0.0.1",
    manualTicks: true,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/telemetry`, {
      method: "POST",
      body: JSON.stringify({
        device: { room: "disabled" },
        events: [{ type: "probe" }],
      }),
    });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
  } finally {
    await app.close();
  }
});

test("development LAN server still records telemetry", async () => {
  const room = `lan-safety-${process.pid}`;
  const file = new URL(
    `../artifacts/telemetry/${room}.ndjson`,
    import.meta.url,
  );
  const app = await createGameServer({
    port: 0,
    hostname: "127.0.0.1",
    manualTicks: true,
    dev: true,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/telemetry`, {
      method: "POST",
      body: JSON.stringify({ device: { room }, events: [{ type: "probe" }] }),
    });
    assert.equal(response.status, 204);
    const saved = JSON.parse((await readFile(file, "utf8")).trim());
    assert.equal(saved.type, "probe");
    assert.deepEqual(saved.device, { room });
  } finally {
    await app.close();
    await rm(file, { force: true });
  }
});
