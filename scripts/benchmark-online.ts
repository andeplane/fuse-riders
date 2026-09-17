import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { createGameServer } from "../src/server/index.js";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  toSnapshot,
} from "../src/shared/game.js";
import type { ServerMessage } from "../src/shared/protocol.js";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ] ?? 0;
const results: Record<string, unknown> = {
  date: new Date().toISOString(),
  environment: `${process.platform}/${process.arch} Node ${process.version}`,
  limitations:
    "Local Node benchmark, no browser rendering or real packet loss. Ordered application-level delay/HOL injection, not TCP emulation. CPU stress uses invulnerable circling riders.",
};
const cpu = [];
for (const shellCount of [0, 5, 20]) {
  const game = createGame("benchmark");
  for (let i = 0; i < 5; i++)
    addPlayer(game, { id: `p${i}`, name: `P${i}`, slot: i, color: "#fff" });
  startMatch(game);
  for (let i = 0; i < 60; i++) step(game, new Map());
  for (const [i, p] of [...game.players.values()].entries())
    Object.assign(p, {
      x: 220 + i * 260,
      y: 400,
      angle: 0,
      invulnerableUntilTick: 100000,
    });
  for (let i = 0; i < shellCount; i++)
    game.bombs.set(i + 1, {
      id: i + 1,
      ownerId: "p0",
      launchX: 400,
      launchY: 200,
      x: 100 + i * 65,
      y: 200,
      launchedTick: 0,
      placedTick: 0,
      landsAtTick: Number.MAX_SAFE_INTEGER,
      explodeAtTick: Number.MAX_SAFE_INTEGER,
      blastRange: 0,
      flightPath: [],
      shell: { vx: 450, vy: 150 },
    });
  const timings: number[] = [];
  const bytes: number[] = [];
  const inputs = new Map(
    [...game.players.keys()].map((id) => [
      id,
      { left: true, right: false, bomb: false },
    ]),
  );
  for (let i = 0; i < 700; i++) {
    const begin = performance.now();
    step(game, inputs);
    const payload = JSON.stringify(toSnapshot(game));
    const elapsed = performance.now() - begin;
    if (i >= 100) {
      timings.push(elapsed);
      bytes.push(Buffer.byteLength(payload));
    }
  }
  cpu.push({
    shellCount,
    p50Ms: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
    p99Ms: percentile(timings, 0.99),
    meanSnapshotBytes: bytes.reduce((a, b) => a + b, 0) / bytes.length,
    fullViewMbpsAt20Hz:
      ((bytes.reduce((a, b) => a + b, 0) / bytes.length) * 20 * 8) / 1e6,
  });
}
results.cpu = cpu;
const network = [];
for (const profile of [
  { name: "LAN", oneWay: 5, jitter: 2, stall: 0 },
  { name: "regional", oneWay: 40, jitter: 10, stall: 0 },
  { name: "poor-wifi", oneWay: 75, jitter: 30, stall: 0.03 },
  { name: "very-poor", oneWay: 150, jitter: 75, stall: 0.05 },
]) {
  const app = await createGameServer({
    port: 0,
    hostname: "127.0.0.1",
    dev: false,
  });
  const sockets: WebSocket[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const latencies: number[] = [];
  let seed = 12345,
    sent = 0,
    acknowledged = 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lane = () => {
    let deadline = 0;
    return (fn: () => void) => {
      const now = performance.now();
      deadline = Math.max(
        deadline,
        now +
          Math.max(0, profile.oneWay + (random() * 2 - 1) * profile.jitter) +
          (random() < profile.stall ? 200 : 0),
      );
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          fn();
        },
        Math.max(0, deadline - now),
      );
      timers.add(timer);
    };
  };
  const peers: Array<() => void> = [];
  try {
    for (let i = 0; i < 5; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, {
        origin: `http://127.0.0.1:${app.port}`,
      });
      sockets.push(ws);
      await once(ws, "open");
      const up = lane(),
        down = lane(),
        pending = new Map<number, number>();
      let seq = 0;
      ws.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type === "inputAck")
          down(() => {
            const at = pending.get(message.seq);
            if (at !== undefined) {
              latencies.push(performance.now() - at);
              acknowledged++;
            }
            for (const id of pending.keys())
              if (id <= message.seq) pending.delete(id);
          });
      });
      ws.send(JSON.stringify({ type: "join", name: `P${i}` }));
      peers.push(() => {
        const id = seq++;
        pending.set(id, performance.now());
        sent++;
        up(() => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({
                type: "input",
                seq: id,
                left: id % 10 < 5,
                right: id % 10 >= 5,
                bomb: false,
              }),
            );
        });
      });
    }
    await sleep(100);
    startMatch(app.game);
    app.advance(60);
    for (const p of app.game.players.values()) p.invulnerableUntilTick = 100000;
    const interval = setInterval(() => peers.forEach((send) => send()), 50);
    await sleep(5000);
    clearInterval(interval);
    await sleep(1000);
    network.push({
      ...profile,
      sent,
      acknowledged,
      p50AckMs: percentile(latencies, 0.5),
      p95AckMs: percentile(latencies, 0.95),
      p99AckMs: percentile(latencies, 0.99),
      maxAckMs: Math.max(...latencies),
    });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    sockets.forEach((ws) => ws.terminate());
    await app.close();
  }
}
results.network = network;
await writeFile(
  "docs/online/baseline.json",
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results, null, 2));
