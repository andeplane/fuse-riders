import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium, type Page } from 'playwright';

// Phase 5: five scripted players plus a TV, one local run and one with injected 40 ms delay, 20 ms jitter and 2% loss.
// Reports per peer: bytes per second each way on the wire, rollbacks per minute and ticks per rollback, input to own
// render, input to remote render, and crash to death shown, as p50 and p95. Injection happens at RTCDataChannel.send
// on the sender, so figures describe the application path on one desktop, not a physical network.
const base = process.env.ONLINE_URL ?? 'http://localhost:8787/', seconds = Number(process.env.MEASURE_SECONDS ?? 40);
interface Snapshot { kind: 'snapshot'; at: number; epochAt: number; matchId: string; round: number; tick: number; phase: string; playerId: string; players: Array<{ id: string; alive: boolean; angle: number }>; metrics: { rollbacks: number; rollbackTicks: number; rtt: Record<string, number>; sentBytes: number } }
interface Input { kind: 'input'; at: number; epochAt: number; left: boolean; right: boolean; tick: number }
interface Death { kind: 'event'; epochAt: number; playerId: string; matchId: string; round: number; tick: number }
interface Wire { sent: number; received: number }
interface Trace { id: string; snapshots: Snapshot[]; inputs: Input[]; deaths: Death[]; wire: Wire; renders: Array<{ epochAt: number; angles: Record<string, number> }> }
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : null; };
const stats = (values: number[]) => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95) });

async function instrument(page: Page, impaired: boolean): Promise<void> {
  await page.addInitScript(([delayMs, jitterMs, loss]) => {
    const snapshots: unknown[] = [], inputs: unknown[] = [], deaths: unknown[] = [], renders: unknown[] = [], wire = { sent: 0, received: 0 };
    Reflect.set(window, '__trace', { snapshots, inputs, deaths, renders, wire });
    const epoch = () => performance.timeOrigin + performance.now();
    window.addEventListener('fuse-benchmark', event => {
      const detail = (event as CustomEvent).detail; const stamped = { ...detail, epochAt: epoch() };
      if (detail.kind === 'snapshot') { snapshots.push(stamped); if (snapshots.length > 4000) snapshots.shift(); }
      else if (detail.kind === 'input') inputs.push(stamped);
      else if (detail.kind === 'event' && detail.event?.type === 'playerEliminated') deaths.push({ kind: 'event', epochAt: stamped.epochAt, playerId: detail.event.playerId, matchId: detail.matchId, round: detail.round, tick: detail.tick });
      else if (detail.kind === 'render') { renders.push(stamped); if (renders.length > 6000) renders.shift(); }
    });
    // Wire accounting and sender-side impairment on the input channel: dropped packets never leave the page.
    const originalSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data: string | ArrayBuffer | ArrayBufferView | Blob) {
      const bytes = typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength ?? 0;
      if (this.label === 'input' && (delayMs as number) > 0) {
        if (Math.random() < (loss as number)) return;
        const copy = (data as Uint8Array).slice();
        setTimeout(() => { if (this.readyState === 'open') { wire.sent += bytes; try { originalSend.call(this, copy); } catch { /* closed meanwhile */ } } }, (delayMs as number) + Math.random() * (jitterMs as number));
        return;
      }
      wire.sent += bytes; return originalSend.call(this, data as unknown as ArrayBufferView<ArrayBuffer>);
    };
    const descriptor = Object.getOwnPropertyDescriptor(RTCDataChannel.prototype, 'onmessage')!;
    Object.defineProperty(RTCDataChannel.prototype, 'onmessage', { ...descriptor, set(handler: ((event: MessageEvent) => void) | null) { descriptor.set!.call(this, handler ? (event: MessageEvent) => { wire.received += typeof event.data === 'string' ? event.data.length : event.data.byteLength ?? 0; handler.call(this, event); } : null); } });
  }, impaired ? [40, 20, .02] : [0, 0, 0] as [number, number, number]);
}

async function run(impaired: boolean): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  const pages: Page[] = [];
  try {
    const host = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage(); pages.push(host);
    await instrument(host, impaired);
    await host.goto(base); await host.getByRole('button', { name: 'CREATE ROOM', exact: true }).click(); await host.waitForURL(/room=/);
    await host.getByPlaceholder('Your name').waitFor(); const target = new URL(host.url()); target.searchParams.set('benchmark', '1'); target.searchParams.set('renderer', 'canvas'); await host.goto(target.href);
    await host.getByPlaceholder('Your name').fill('Host'); await host.getByRole('button', { name: 'JOIN AS PLAYER', exact: true }).click();
    const invite = host.url();
    for (let index = 1; index < 5; index++) {
      const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage(); pages.push(page);
      await instrument(page, impaired); await page.goto(invite); await page.getByPlaceholder('Your name').fill(`Rider ${index}`); await page.getByRole('button', { name: 'JOIN AS PLAYER', exact: true }).click();
      await host.locator(':is(.online-roster,.room-riders):visible').getByText(`Rider ${index}`, { exact: false }).waitFor();
    }
    const tv = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); pages.push(tv);
    await instrument(tv, impaired); await tv.goto(invite + '&display=1'); await tv.locator(':is(.online-roster,.room-riders):visible').getByText('Rider 4', { exact: false }).waitFor();
    await host.getByRole('button', { name: 'START RACE', exact: true }).click();
    for (const page of pages) await page.waitForFunction(() => { const trace = Reflect.get(window, '__trace') as { snapshots: Snapshot[] }; return trace.snapshots.at(-1)?.phase === 'playing'; }, undefined, { timeout: 30_000 });
    const started = performance.now(), players = pages.slice(0, 5);
    // Scripted steering: each rider alternates turns on its own cadence and fires now and then, so rounds keep ending and restarting.
    let step = 0;
    while (performance.now() - started < seconds * 1000) {
      const index = step % 5, page = players[index]!, key = (step * 7 + index) % 3 === 0 ? 'ArrowLeft' : (step * 7 + index) % 3 === 1 ? 'ArrowRight' : 'Space';
      await page.keyboard.down(key); await page.waitForTimeout(120 + (step % 4) * 60); await page.keyboard.up(key);
      step++;
    }
    const traces: Trace[] = [];
    for (const page of pages) traces.push(await page.evaluate(() => { const trace = Reflect.get(window, '__trace') as Omit<Trace, 'id'>; return { id: (trace.snapshots.at(-1) as Snapshot | undefined)?.playerId ?? 'tv', ...trace }; }));
    const elapsed = (performance.now() - started) / 1000;
    const perPeer = traces.map(trace => {
      const first = trace.snapshots.find(s => s.phase === 'playing'), last = trace.snapshots.at(-1)!;
      const minutes = Math.max(1e-6, (last.epochAt - (first?.epochAt ?? last.epochAt)) / 60_000);
      const rollbacks = last.metrics.rollbacks - (first?.metrics.rollbacks ?? 0), rollbackTicks = last.metrics.rollbackTicks - (first?.metrics.rollbackTicks ?? 0);
      const ownLatency: number[] = [], remoteLatency: number[] = [];
      for (const input of trace.inputs) {
        if (!input.left && !input.right) continue;
        const before = trace.snapshots.filter(s => s.epochAt <= input.epochAt).at(-1); if (!before) continue;
        const rider = before.players.find(p => p.id === trace.id); if (!rider?.alive) continue;
        const changed = trace.snapshots.find(s => s.epochAt > input.epochAt && (s.players.find(p => p.id === trace.id)?.angle ?? rider.angle) !== rider.angle);
        if (changed && changed.epochAt - input.epochAt < 2000) ownLatency.push(changed.epochAt - input.epochAt);
        for (const other of traces) {
          if (other === trace) continue;
          const seen = other.snapshots.find(s => s.epochAt > input.epochAt && (s.players.find(p => p.id === trace.id)?.angle ?? rider.angle) !== rider.angle);
          if (seen && seen.epochAt - input.epochAt < 2000) remoteLatency.push(seen.epochAt - input.epochAt);
        }
      }
      return { id: trace.id, bytesPerSecond: { sent: Math.round(trace.wire.sent / elapsed), received: Math.round(trace.wire.received / elapsed) }, rollbacksPerMinute: Number((rollbacks / minutes).toFixed(1)), ticksPerRollback: rollbacks ? Number((rollbackTicks / rollbacks).toFixed(1)) : 0, inputToOwnStateMs: stats(ownLatency), inputToRemoteStateMs: stats(remoteLatency), rtt: last.metrics.rtt };
    });
    // Crash to death shown: the earliest page to emit a death versus every other page emitting the same death.
    const deathDelays: number[] = [];
    const deaths = new Map<string, number[]>();
    for (const trace of traces) for (const death of trace.deaths) { const key = `${death.matchId}:${death.round}:${death.tick}:${death.playerId}`; deaths.set(key, [...(deaths.get(key) ?? []), death.epochAt]); }
    for (const times of deaths.values()) { const first = Math.min(...times); for (const time of times) if (time !== first) deathDelays.push(time - first); }
    return { impaired, seconds: elapsed, peers: perPeer, crashToDeathShownMs: stats(deathDelays), deathsObserved: deaths.size, rounds: Math.max(...traces.map(trace => trace.snapshots.at(-1)!.round)) };
  } finally { await browser.close(); }
}

await mkdir('artifacts', { recursive: true });
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), url: base, method: 'Five scripted Chromium players plus a TV on one desktop. Impairment injects 40 ms delay, 20 ms jitter and 2% loss at the sender\'s input-channel send; wire bytes count data-channel payloads. Latencies are input event to the first simulated state showing the changed heading, stamped with page clocks on one machine.', runs: [] as Record<string, unknown>[] };
for (const impaired of [false, true]) { const result = await run(impaired); report.runs.push(result); console.log(JSON.stringify(result, null, 1)); }
await writeFile('artifacts/p2p-measure.json', JSON.stringify(report, null, 2));
for (const result of report.runs) assert.ok((result.peers as Array<{ bytesPerSecond: { sent: number } }>).every(peer => peer.bytesPerSecond.sent < 15_000 * 5), 'under 15 KB/s per link each way');
console.log('Measurements written to artifacts/p2p-measure.json');
