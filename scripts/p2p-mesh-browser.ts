import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium, webkit, type Page } from "playwright";
import { smokeTimeout } from "./smoke-timeout.js";

// Phase 3 gate: six contexts alternating Chromium and WebKit establish all fifteen links, exchange packets in all
// thirty directions, recover from a three-second send blackhole and rebuild a closed channel with zero page errors.
const url = process.env.ONLINE_URL ?? "http://localhost:8787/";
await mkdir("artifacts", { recursive: true });
await writeFile(
  "dist/mesh-fixture.html",
  "<!doctype html><title>Mesh transport fixture</title>",
);
const response = await fetch(new URL("/api/rooms", url), { method: "POST" });
assert.ok(response.ok, `room creation failed: ${response.status}`);
const room = (await response.json()) as { code: string; token: string };
const bundle = await build({
  stdin: {
    contents: `
import { PeerTransport } from 'fuse-network-fe';
import { encodePacket, decodePacket, roomHash } from './src/online/packet.ts';
globalThis.startMesh = (code, token) => {
  let linkDrops = 0; const peers = new Set(), links = new Set(), received = new Map(), messages = [], errors = [], statuses = [];
  let dropFast = false; const originalSend = RTCDataChannel.prototype.send;
  // Browser impairment harness only: a send blackhole on the input channel, never real packet loss.
  RTCDataChannel.prototype.send = function (data) { if (dropFast && this.label === 'input') return; return originalSend.call(this, data); };
  const channels = []; const originalCreate = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function (...args) { const channel = originalCreate.apply(this, args); channels.push(channel); return channel; };
  // The lower peer id offers every link, so a peer whose id sorts above all others creates no channel at all: record
  // the answerer's side too, or closeInput finds nothing to close for that peer.
  const onDataChannel = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'ondatachannel');
  Object.defineProperty(RTCPeerConnection.prototype, 'ondatachannel', { ...onDataChannel, set(handler) { onDataChannel.set.call(this, handler && (event => { channels.push(event.channel); return handler.call(this, event); })); } });
  // linked() proves reliable-channel health, not that the independently opened input channels are ready.
  const inputReady = () => channels.filter(channel => channel.label === 'input' && channel.readyState === 'open').length === peers.size;
  const transport = new PeerTransport(code, token, {
    welcome: () => {}, peer: (id, online) => { if (online) peers.add(id); else { peers.delete(id); links.delete(id); } },
    link: (id, open) => { if (open) links.add(id); else { links.delete(id); linkDrops++; } },
    message: (id, data) => messages.push({ from: id, data }),
    fast: (id, bytes) => { const decoded = decodePacket(bytes); if (decoded && 'packet' in decoded) received.set(id, (received.get(id) ?? 0) + 1); },
    status: text => { statuses.push(text); if (statuses.length > 40) statuses.shift(); },
    revoked: () => errors.push('revoked'), ended: () => errors.push('ended'), terminated: text => errors.push('terminated: ' + text),
  }, { apiUrl: path => new URL(path, location.origin).href });
  transport.connect();
  let seq = 0;
  globalThis.mesh = {
    id: () => transport.id,
    peers: () => [...peers], links: () => [...links],
    ready: () => peers.size === 5 && inputReady() && [...peers].every(id => transport.linked(id)),
    send: () => { let sent = 0; for (const id of peers) { const bytes = encodePacket({ room: roomHash('mesh'), from: transport.id, generation: 1, through: ++seq, lastSeq: 0, entries: [], sentAt: 1, echoSentAt: 0, echoHeld: 0, clockTick: seq, hash: null }); if (transport.sendFast(id, bytes)) sent++; } return sent; },
    received: () => Object.fromEntries(received), receivedFromAll: () => received.size === 5 && [...received.values()].every(count => count > 0),
    reliable: () => { let sent = 0; for (const id of peers) if (transport.send(id, { type: 'hello', generation: 1, full: true, rules: 'harness' })) sent++; return sent; },
    messagesFromAll: () => new Set(messages.map(message => message.from)).size === 5,
    blackhole: value => { dropFast = value; }, linkDrops: () => linkDrops,
    closeInput: () => { const channel = channels.find(item => item.label === 'input' && item.readyState === 'open'); if (!channel) return false; channel.close(); return true; },
    snapshot: async () => ({ id: transport.id, peers: [...peers], links: [...links], received: Object.fromEntries(received), errors, statuses, stats: await transport.stats(), diagnostics: await transport.diagnostics() }),
    stop: () => transport.close(),
  };
};`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
});
interface Snapshot {
  id: string;
  peers: string[];
  links: string[];
  received: Record<string, number>;
  errors: string[];
  statuses: string[];
  stats: { direct: number; relayed: number; buffered: number };
}
const mesh = <T>(page: Page, expression: string, argument?: unknown) =>
  page.evaluate(
    ([code, value]) =>
      (0, eval)(`(mesh) => ${code}`)(
        (globalThis as unknown as { mesh: unknown }).mesh,
        value,
      ),
    [expression, argument] as [string, unknown],
  ) as Promise<T>;
const browsers = [
  await chromium.launch({ headless: true }),
  await webkit.launch({ headless: true }),
];
const pages: Page[] = [],
  errors: string[] = [];
const tokens = Array.from({ length: 6 }, (_, index) =>
  index === 0 ? room.token : randomBytes(32).toString("hex"),
);
let phase = "bootstrap";
const report: Record<string, unknown> = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  url,
  phases: {} as Record<string, unknown>,
};
const waitReady = async (label: string, timeout = smokeTimeout(40_000)) => {
  const started = performance.now();
  for (const page of pages)
    await page.waitForFunction(
      () =>
        (globalThis as unknown as { mesh: { ready(): boolean } }).mesh.ready(),
      undefined,
      { timeout },
    );
  (report.phases as Record<string, unknown>)[label] = Math.round(
    performance.now() - started,
  );
};
try {
  for (let index = 0; index < 6; index++) {
    const context = await browsers[index % 2]!.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(smokeTimeout(30_000));
    pages.push(page);
    page.on("pageerror", (error) => {
      errors.push(
        `peer ${index} ${index % 2 ? "webkit" : "chromium"} ${phase}: ${error.stack || error.message}`,
      );
    });
    // A real HTTP response keeps the browser's local-network address-space classification intact.
    await page.goto(new URL("/mesh-fixture.html", url).href);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(
      ([code, token]) =>
        (
          globalThis as unknown as {
            startMesh(code: string, token: string): void;
          }
        ).startMesh(code, token),
      [room.code, tokens[index]!],
    );
  }
  await waitReady("links");
  const ready = await Promise.all(
    pages.map((page) => mesh<Snapshot>(page, "mesh.snapshot()")),
  );
  assert.ok(
    ready.every((peer) => peer.stats.direct === 5 && peer.stats.relayed === 0),
    "fifteen direct links",
  );
  console.log(
    "Six peers (Chromium and WebKit alternating) established fifteen direct links with game and input channels.",
  );
  phase = "packets";
  for (const page of pages)
    assert.equal(await mesh<number>(page, "mesh.send()"), 5);
  for (const page of pages)
    await page.waitForFunction(
      () =>
        (
          globalThis as unknown as { mesh: { receivedFromAll(): boolean } }
        ).mesh.receivedFromAll(),
      undefined,
      { timeout: smokeTimeout(10_000) },
    );
  for (const page of pages)
    assert.equal(await mesh<number>(page, "mesh.reliable()"), 5);
  for (const page of pages)
    await page.waitForFunction(
      () =>
        (
          globalThis as unknown as { mesh: { messagesFromAll(): boolean } }
        ).mesh.messagesFromAll(),
      undefined,
      { timeout: smokeTimeout(10_000) },
    );
  console.log(
    "Packets and reliable messages delivered in all thirty directions.",
  );
  phase = "blackhole";
  const victim = pages[1]!;
  await mesh(victim, "mesh.blackhole(true)");
  await victim.waitForTimeout(3000);
  for (let round = 0; round < 3; round++) {
    await mesh(victim, "mesh.send()");
    await victim.waitForTimeout(smokeTimeout(100));
  }
  const before = await Promise.all(
    pages.map((page) => mesh<Record<string, number>>(page, "mesh.received()")),
  );
  const recoveryStart = performance.now();
  await mesh(victim, "mesh.blackhole(false)");
  await waitReady("blackhole-recovery", smokeTimeout(10_000));
  for (let attempt = 0; attempt < 20; attempt++) {
    await mesh(victim, "mesh.send()");
    await victim.waitForTimeout(smokeTimeout(50));
  }
  const victimId = await mesh<string>(victim, "mesh.id()");
  for (const [index, page] of pages.entries())
    if (page !== victim)
      await page.waitForFunction(
        ([id, count]) =>
          ((
            globalThis as unknown as {
              mesh: { received(): Record<string, number> };
            }
          ).mesh.received()[id as string] ?? 0) > (count as number),
        [victimId, before[index]![victimId] ?? 0],
        { timeout: smokeTimeout(10_000) },
      );
  console.log(
    "Fast delivery from the blackholed peer resumed",
    Math.round(performance.now() - recoveryStart),
    "ms after the three-second send blackhole ended.",
  );
  phase = "channel-closure";
  // A drained link can rebuild before a poll for "not ready" ever runs, so wait for the drop event itself. Every link
  // is ready first, so no drop left over from the blackhole can stand in for this one.
  await waitReady("before-closure");
  const drops = await mesh<number>(victim, "mesh.linkDrops()");
  assert.equal(await mesh<boolean>(victim, "mesh.closeInput()"), true);
  await victim.waitForFunction(
    (count) =>
      (
        globalThis as unknown as { mesh: { linkDrops(): number } }
      ).mesh.linkDrops() > count,
    drops,
    { timeout: smokeTimeout(10_000) },
  );
  await waitReady("channel-rebuild", smokeTimeout(60_000));
  for (const page of pages)
    assert.equal(await mesh<number>(page, "mesh.send()"), 5);
  console.log(
    "A closed input channel drained its link and the initiator rebuilt it; every peer sends again.",
  );
  const final = await Promise.all(
    pages.map((page) => mesh<Snapshot>(page, "mesh.snapshot()")),
  );
  assert.ok(
    final.every((peer) => peer.errors.length === 0),
    JSON.stringify(final.map((peer) => peer.errors)),
  );
  assert.deepEqual(errors, []);
  report.peers = final.map((peer) => ({
    id: peer.id,
    links: peer.links.length,
    received: peer.received,
    stats: peer.stats,
  }));
  report.passed = true;
  console.log("Mesh transport harness passed with zero page errors.");
} catch (error) {
  report.passed = false;
  report.error = String(error);
  report.pageErrors = errors;
  report.diagnostics = await Promise.all(
    pages.map((page) =>
      mesh<Snapshot>(page, "mesh.snapshot()").catch(() => "unavailable"),
    ),
  );
  throw error;
} finally {
  for (const page of pages) await mesh(page, "mesh.stop()").catch(() => {});
  await writeFile(
    "artifacts/p2p-mesh-browser.json",
    JSON.stringify(report, null, 2),
  );
  for (const browser of browsers) await browser.close();
}
