import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, webkit, type Page } from 'playwright';
import type { TrafficWindow, TrafficSnapshot } from './fixtures/direct-traffic-fixture.js';

const url = process.env.ONLINE_URL ?? 'http://localhost:8812/';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Measurement creates automated participants only on a local test service');
const run = process.env.TRAFFIC_RUN ?? 'exploratory';
assert.match(run, /^[a-zA-Z0-9_-]+$/);
await mkdir('artifacts', { recursive: true });
await writeFile('dist/traffic-fixture.html', '<!doctype html><title>Direct gameplay traffic measurement</title>');
const bundle = await build({ entryPoints: ['scripts/fixtures/direct-traffic-fixture.ts'], bundle: true, metafile: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_API_ORIGIN': 'undefined' } });
const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(bundle.metafile!.inputs).filter(path => !path.startsWith('node_modules/')).map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const response = await fetch(new URL('/api/rooms', url), { method: 'POST' }); assert.ok(response.ok);
const room = await response.json() as { code: string; token: string };
const browsers = [await chromium.launch({ headless: true }), await webkit.launch({ headless: true })];
const pages: Page[] = [], errors: string[] = [];
let passed = false, start = 0, end = 0, failure: string | undefined;
let samples: TrafficSnapshot[] = [];
const snapshot = (page: Page) => page.evaluate(() => (globalThis as unknown as TrafficWindow).traffic.snapshot());
try {
  for (let index = 0; index < 6; index++) {
    const context = await browsers[index % 2].newContext(), page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => { errors.push(`${index}: ${error.stack ?? error.message}`); });
    await page.goto(new URL(`/traffic-fixture.html${index === 5 ? '?display=1' : ''}`, url).href);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ code, token, index }) => (globalThis as unknown as TrafficWindow).startTraffic(code, token, index), { code: room.code, token: index === 0 ? room.token : randomBytes(32).toString('hex'), index });
  }
  for (const page of pages) await page.waitForFunction(() => (globalThis as unknown as TrafficWindow).traffic.ready(), undefined, { timeout: 30_000 });
  start = Date.now() + 500;
  await Promise.all(pages.map(page => page.evaluate(at => (globalThis as unknown as TrafficWindow).traffic.begin(at), start)));
  console.log('Measuring a three-round match: five scripted player origins, six simulators, mixed Chromium/WebKit, real local WebRTC.');
  const progress = setInterval(() => { void snapshot(pages[0]).then(s => console.log(JSON.stringify({ elapsed: (Date.now() - start) / 1000, phase: s.phase, round: s.round, tick: s.tick, diagnostics: s.diagnostics }))).catch(() => {}); }, 5000);
  try {
    await Promise.all(pages.map(page => page.waitForFunction(() => {
      const s = (globalThis as unknown as TrafficWindow).traffic.snapshot();
      if (s.diagnostics.recoveryRequired) throw new Error('Game required recovery');
      return s.phase === 'matchOver';
    }, undefined, { timeout: 240_000 })));
  } finally { clearInterval(progress); }
  end = Date.now() + 250;
  await Promise.all(pages.map(page => page.evaluate(at => (globalThis as unknown as TrafficWindow).traffic.finish(at), end)));
  await pages[0].waitForTimeout(300);
  samples = await Promise.all(pages.map(snapshot));
  assert.ok(samples.every(s => s.round === 3 && s.phase === 'matchOver' && s.diagnostics.simulator && !s.diagnostics.recoveryRequired));
  assert.ok(samples.slice(0, 5).every(s => s.acceptedInputs > 0));
  for (const sample of samples) {
    assert.deepEqual(sample.outcome, samples[0].outcome, 'All six engines agree on finalized placements, leaderboard and match statistics');
    for (const round of [1, 2, 3]) assert.ok(sample.phases.some(p => p.at >= start && p.round === round && p.phase === 'playing'), `Peer ${sample.index} played round ${round}`);
  }
  assert.ok(samples.every(s => !s.rx['ws:welcome'] && !s.rx['ws:peer'] && !s.tx['ws:signal']), 'No service reconnect, membership change or renegotiation during the measurement window');
  assert.ok(samples.every(s => !s.notices.some(n => n.at >= start && /disconnected|failed|interrupted|timed out|membership changed|could not restore/i.test(n.text))), 'No hidden recovery during the measurement window');
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) { failure = String(error); throw error; }
finally {
  if (!samples.length) samples = await Promise.all(pages.map(page => snapshot(page).catch(() => undefined))).then(all => all.filter((s): s is TrafficSnapshot => !!s));
  for (const page of pages) await page.evaluate(() => (globalThis as unknown as TrafficWindow).traffic?.stop()).catch(() => {});
  await Promise.all(browsers.map(browser => browser.close()));
  const seconds = end > start ? (end - start) / 1000 : undefined;
  const totals = samples.map(s => {
    const sum = (direction: 'tx' | 'rx', prefix: string) => Object.entries(s[direction]).filter(([key]) => key.startsWith(prefix)).reduce((n, [, count]) => n + count.bytes, 0);
    return { index: s.index, engine: s.index % 2 ? 'webkit' : 'chromium', rtcUpload: sum('tx', 'rtc:'), rtcDownload: sum('rx', 'rtc:'), signallingUpload: sum('tx', 'ws:'), signallingDownload: sum('rx', 'ws:'), rtcUploadBytesPerSecond: seconds ? sum('tx', 'rtc:') / seconds : null, rtcDownloadBytesPerSecond: seconds ? sum('rx', 'rtc:') / seconds : null };
  });
  const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), sourceHashes, bundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'), passed, failure, start, end, seconds, method: 'Real RoomRuntime and PeerTransport, five scripted human origins plus display, six simulators alternating Chromium/WebKit. Three-round default-pickup match; window starts before start command and includes countdowns, automatic round transitions and match completion. Native accepted-send and delivered-message application bytes classified for every RTC/WS payload. Excludes room-join bootstrap, HTTP requests/handshakes, SCTP/DTLS/IP headers, retransmission wire cost and rendering. Local network, no injected impairment. This workload is not matched to the historical five-bot serializer benchmark.', totals, samples, errors };
  await writeFile(`artifacts/direct-traffic-${run}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed, seconds, totals, failure, errors }, null, 2));
  await rm('dist/traffic-fixture.html', { force: true });
  assert.deepEqual(errors, [], 'No browser or teardown errors');
}
