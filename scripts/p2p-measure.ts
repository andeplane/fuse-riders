import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright";
import { ridersPageUrl } from "./lib/riders-url.js";
import { readyRoom } from "./lib/ready-room.js";
import {
  responseLatencies,
  withinLatencyBudget,
  type SteeringInput,
  type ControlSample,
} from "./lib/response-latency.js";

// Phase 5: five scripted players plus a TV, one local run and one with injected 40 ms delay, 20 ms jitter and 2% loss.
// Reports per peer: bytes per second each way on the wire, rollbacks per minute and ticks per rollback, input to own
// render, input to remote render, and crash to death shown, as p50 and p95. Injection happens at RTCDataChannel.send
// on the sender, so figures describe the application path on one desktop, not a physical network.
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  seconds = Number(process.env.MEASURE_SECONDS ?? 40);
interface Snapshot {
  kind: "snapshot";
  at: number;
  epochAt: number;
  matchId: string;
  round: number;
  tick: number;
  phase: string;
  playerId: string;
  players: Array<{
    id: string;
    alive: boolean;
    angle: number;
    heldMotion?: { left: boolean; right: boolean };
  }>;
  metrics: {
    rollbacks: number;
    rollbackTicks: number;
    rtt: Record<string, number>;
    sentBytes: number;
  };
}
interface Input extends SteeringInput {
  kind: "input";
  at: number;
  epochAt: number;
  left: boolean;
  right: boolean;
  tick: number;
}
interface Death {
  kind: "event";
  epochAt: number;
  playerId: string;
  matchId: string;
  round: number;
  tick: number;
}
interface Wire {
  sent: number;
  received: number;
}
interface Trace {
  id: string;
  snapshots: Snapshot[];
  inputs: Input[];
  deaths: Death[];
  wire: Wire;
  renders: ControlSample[];
}
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
    : null;
};
const stats = (values: number[]) => ({
  count: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
});

export async function instrument(page: Page, impaired: boolean): Promise<void> {
  const [delayMs, jitterMs, loss] = impaired ? [40, 20, 0.02] : [0, 0, 0];
  // A plain string: the TypeScript loader would otherwise inject helpers into a serialized function that the page lacks.
  await page.addInitScript(`(() => {
    const snapshots = [], inputs = [], deaths = [], renders = [], wire = { sent: 0, received: 0 };
    window.__trace = { snapshots, inputs, deaths, renders, wire };
    const epoch = () => performance.timeOrigin + performance.now();
    let seed = 7;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    window.__trace.dropFastUntil = 0;
    window.addEventListener('fuse-benchmark', event => {
      const detail = event.detail; const stamped = { ...detail, epochAt: epoch() };
      if (detail.kind === 'snapshot') { snapshots.push(stamped); if (snapshots.length > 4000) snapshots.shift(); }
      else if (detail.kind === 'input') inputs.push(stamped);
      else if (detail.kind === 'prediction') { renders.push(stamped); if (renders.length > 10000) renders.shift(); }
      else if (detail.kind === 'event' && detail.event && detail.event.type === 'playerEliminated') deaths.push({ kind: 'event', epochAt: stamped.epochAt, playerId: detail.event.playerId, matchId: detail.matchId, round: detail.round, tick: detail.tick });
    });
    // Wire accounting and sender-side impairment on the input channel: dropped packets never leave the page.
    const originalSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      const bytes = typeof data === 'string' ? data.length : (data.byteLength || 0);
      if (this.label === 'input' && epoch() < window.__trace.dropFastUntil) return;
      if (this.label === 'input' && ${delayMs} > 0) {
        if (random() < ${loss}) return;
        const copy = data.slice();
        setTimeout(() => { if (this.readyState === 'open') { wire.sent += bytes; try { originalSend.call(this, copy); } catch (e) {} } }, ${delayMs} + random() * ${jitterMs});
        return;
      }
      wire.sent += bytes; return originalSend.call(this, data);
    };
    const descriptor = Object.getOwnPropertyDescriptor(RTCDataChannel.prototype, 'onmessage');
    Object.defineProperty(RTCDataChannel.prototype, 'onmessage', { ...descriptor, set(handler) { descriptor.set.call(this, handler ? event => { wire.received += typeof event.data === 'string' ? event.data.length : (event.data.byteLength || 0); handler.call(this, event); } : null); } });
  })();`);
}

async function run(impaired: boolean): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  const pages: Page[] = [];
  try {
    const host = await (
      await browser.newContext({ viewport: { width: 1000, height: 700 } })
    ).newPage();
    pages.push(host);
    await instrument(host, impaired);
    // The room is the join screen: the creator seats itself on arrival, like every other rider below.
    await host.addInitScript(() =>
      localStorage.setItem("fuse-riders-player-name", "Host"),
    );
    const entrance = new URL(ridersPageUrl(base));
    entrance.searchParams.set("mute", "");
    await host.goto(entrance.href);
    await host
      .getByRole("button", { name: "CREATE ROOM", exact: true })
      .click();
    await host.waitForURL(/room=/);
    await host.locator(".room-riders > .room-rider").first().waitFor();
    const target = new URL(host.url());
    target.searchParams.set("benchmark", "1");
    target.searchParams.set("renderer", "phaser-canvas");
    await host.goto(target.href);
    await host.locator(".room-riders > .room-rider").first().waitFor();
    const invite = host.url();
    for (let index = 1; index < 5; index++) {
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 700 } })
      ).newPage();
      pages.push(page);
      await instrument(page, impaired);
      // The room is the join screen: each rider seats itself under the name this browser remembers.
      await page.addInitScript(
        (rider) => localStorage.setItem("fuse-riders-player-name", rider),
        `Rider ${index}`,
      );
      await page.goto(invite);
      await host
        .locator(":is(.online-roster,.room-riders):visible")
        .getByText(`Rider ${index}`, { exact: false })
        .waitFor();
    }
    const tv = await (
      await browser.newContext({ viewport: { width: 1280, height: 800 } })
    ).newPage();
    pages.push(tv);
    await instrument(tv, impaired);
    await tv.goto(invite + "&display=1");
    await tv
      .locator(":is(.online-roster,.room-riders):visible")
      .getByText("Rider 4", { exact: false })
      .waitFor();
    await readyRoom(host);
    for (const page of pages)
      await page.waitForFunction(
        () => {
          const trace = Reflect.get(window, "__trace") as {
            snapshots: Snapshot[];
          };
          return trace.snapshots.at(-1)?.phase === "playing";
        },
        undefined,
        { timeout: 30_000 },
      );
    const started = performance.now(),
      players = pages.slice(0, 5);
    // Scripted steering: each rider alternates turns on its own cadence and fires now and then, so rounds keep ending and restarting.
    let step = 0;
    while (performance.now() - started < seconds * 1000) {
      const phase = await host.evaluate(
        () =>
          (
            Reflect.get(window, "__trace") as { snapshots: Snapshot[] }
          ).snapshots.at(-1)?.phase,
      );
      if (phase === "roundOver" || phase === "matchOver") {
        const canReady = await host
          .getByRole("button", {
            name: /^(READY|READY FOR REMATCH|NOT READY)$/,
            includeHidden: true,
          })
          .evaluateAll((nodes) =>
            nodes.some((node) => !(node as HTMLButtonElement).hidden),
          );
        if (canReady) await readyRoom(host);
      }
      const index = step % 5,
        page = players[index]!,
        key =
          (step * 7 + index) % 3 === 0
            ? "ArrowLeft"
            : (step * 7 + index) % 3 === 1
              ? "ArrowRight"
              : "Space";
      await page.keyboard.down(key);
      await page.waitForTimeout(120 + (step % 4) * 60);
      await page.keyboard.up(key);
      step++;
    }
    const traces: Trace[] = [];
    for (const page of pages)
      traces.push(
        await page.evaluate(() => {
          const trace = Reflect.get(window, "__trace") as Omit<Trace, "id">;
          return {
            id:
              (trace.snapshots.at(-1) as Snapshot | undefined)?.playerId ??
              "tv",
            ...trace,
          };
        }),
      );
    const elapsed = (performance.now() - started) / 1000;
    const perPeer = traces.map((trace) => {
      const first = trace.snapshots.find((s) => s.phase === "playing"),
        last = trace.snapshots.at(-1)!;
      const minutes = Math.max(
        1e-6,
        (last.epochAt - (first?.epochAt ?? last.epochAt)) / 60_000,
      );
      const rollbacks =
          last.metrics.rollbacks - (first?.metrics.rollbacks ?? 0),
        rollbackTicks =
          last.metrics.rollbackTicks - (first?.metrics.rollbackTicks ?? 0);
      const ownResponse = responseLatencies(
        trace.inputs,
        trace.snapshots,
        trace.snapshots,
        trace.id,
      );
      const remoteResponse = traces
        .filter((other) => other !== trace)
        .map((other) =>
          responseLatencies(
            trace.inputs,
            trace.snapshots,
            other.snapshots,
            trace.id,
          ),
        );
      const ownLatency = [...ownResponse.press, ...ownResponse.release];
      const remoteLatency = remoteResponse.flatMap((response) => [
        ...response.press,
        ...response.release,
      ]);
      return {
        id: trace.id,
        playingRider: trace.snapshots.some(
          (sample) =>
            sample.phase === "playing" &&
            sample.players.some(
              (player) => player.id === trace.id && player.alive,
            ),
        ),
        ownInputs: ownResponse.eligible,
        payloadBytesPerSecond: {
          sent: Math.round(trace.wire.sent / elapsed),
          received: Math.round(trace.wire.received / elapsed),
        },
        rollbacksPerMinute: Number((rollbacks / minutes).toFixed(1)),
        ticksPerRollback: rollbacks
          ? Number((rollbackTicks / rollbacks).toFixed(1))
          : 0,
        inputToOwnStateMs: stats(ownLatency),
        inputToRemoteStateMs: stats(remoteLatency),
        pressToRemoteStateMs: stats(
          remoteResponse.flatMap((response) => response.press),
        ),
        releaseToRemoteStateMs: stats(
          remoteResponse.flatMap((response) => response.release),
        ),
        responses: {
          eligible:
            ownResponse.eligible +
            remoteResponse.reduce(
              (sum, response) => sum + response.eligible,
              0,
            ),
          timedOut:
            ownResponse.timedOut +
            remoteResponse.reduce(
              (sum, response) => sum + response.timedOut,
              0,
            ),
        },
        rtt: last.metrics.rtt,
      };
    });
    // Crash to death shown: the earliest page to emit a death versus every other page emitting the same death.
    const deathDelays: number[] = [];
    const deaths = new Map<string, number[]>();
    for (const trace of traces)
      for (const death of trace.deaths) {
        const key = `${death.matchId}:${death.round}:${death.tick}:${death.playerId}`;
        deaths.set(key, [...(deaths.get(key) ?? []), death.epochAt]);
      }
    for (const times of deaths.values()) {
      const first = Math.min(...times);
      for (const time of times)
        if (time !== first) deathDelays.push(time - first);
    }
    return {
      impaired,
      seconds: elapsed,
      peers: perPeer,
      crashToDeathShownMs: stats(deathDelays),
      deathsObserved: deaths.size,
      rounds: Math.max(...traces.map((trace) => trace.snapshots.at(-1)!.round)),
    };
  } catch (error) {
    for (const [index, page] of pages.entries())
      console.error(
        `MEASURE DIAGNOSTIC ${index}`,
        await page
          .evaluate(() => ({
            status: document.querySelector(".online-status")?.textContent,
            notice: document.querySelector(".online-notice")?.textContent,
            metrics:
              document.querySelector<HTMLElement>("#app")?.dataset.metrics,
            latest: (
              Reflect.get(window, "__trace") as { snapshots: Snapshot[] }
            ).snapshots.at(-1),
          }))
          .catch(() => "unavailable"),
      );
    throw error;
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop()!)
)
  await main();
async function main(): Promise<void> {
  await mkdir("artifacts", { recursive: true });
  const report = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    url: base,
    method:
      "Five scripted Chromium players plus a TV on one desktop. Seed 7 injects 40–60 ms delay and 2% application-message loss. Bytes are data-channel payload bytes. Latencies match applied press/release controls within the same match and round; missing or superseded responses are counted explicitly. This is not physical-network or touch-to-photon evidence.",
    runs: [] as Record<string, unknown>[],
  };
  for (const impaired of [false, true]) {
    const result = await run(impaired);
    report.runs.push(result);
    console.log(JSON.stringify(result, null, 1));
  }
  await writeFile(
    "artifacts/p2p-measure.json",
    JSON.stringify(report, null, 2),
  );
  for (const result of report.runs)
    assert.ok(
      (
        result.peers as Array<{
          playingRider: boolean;
          ownInputs: number;
          payloadBytesPerSecond: { sent: number };
          inputToRemoteStateMs: { p95: number | null };
          responses: { eligible: number; timedOut: number };
        }>
      ).every(
        (peer) =>
          peer.payloadBytesPerSecond.sent < 15_000 * 5 &&
          withinLatencyBudget({
            playingRider: peer.playingRider,
            ownInputs: peer.ownInputs,
            ...peer.responses,
            p95: peer.inputToRemoteStateMs.p95,
          }),
      ),
      "under 15 KB/s per link, remote control p95 under 600 ms, at least 80% of eligible transitions observed",
    );
  console.log("Measurements written to artifacts/p2p-measure.json");
}
