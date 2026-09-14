import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, type Page } from 'playwright';
import type { TrafficWindow, TrafficSnapshot } from './fixtures/direct-traffic-fixture.js';
import { directNetworkProfiles } from './fixtures/direct-network-queue.js';

const url = process.env.ONLINE_URL ?? 'http://localhost:8812/';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Measurement creates automated participants only on a local test service');
const run = process.env.TRAFFIC_RUN ?? 'exploratory';
const durationSeconds = Number(process.env.TRAFFIC_DURATION_SECONDS ?? 0);
assert.ok(Number.isInteger(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 3600);
const profile=process.env.TRAFFIC_PROFILE??'local',seed=Number(process.env.TRAFFIC_SEED??12345);
assert.ok(directNetworkProfiles[profile]);assert.ok(Number.isSafeInteger(seed)&&seed>=0&&seed<=0xffffffff);
assert.match(run, /^[a-zA-Z0-9_-]+$/);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
await mkdir('artifacts', { recursive: true });
await writeFile('dist/traffic-fixture.html', '<!doctype html><title>Direct gameplay traffic measurement</title>');
const sourceHashes:Record<string,string>={};
const bundle = await build({ entryPoints: ['scripts/fixtures/direct-traffic-fixture.ts'], bundle: true, metafile: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_API_ORIGIN': 'undefined' },plugins:[{name:'record-exact-source',setup(build){build.onLoad({filter:/\.[jt]s$/},async args=>{
  const path=relative(process.cwd(),args.path);if(path.startsWith('node_modules/')||path.startsWith('../'))return;
  const contents=await readFile(args.path);sourceHashes[path]=createHash('sha256').update(contents).digest('hex');return {contents,loader:args.path.endsWith('.ts')?'ts':'js'};
 });}}] });
assert.ok(Object.keys(bundle.metafile!.inputs).filter(path=>!path.startsWith('node_modules/')).every(path=>sourceHashes[path]),'Every local bundle input has a hash of its loaded bytes');
const response = await fetch(new URL('/api/rooms', url), { method: 'POST' }); assert.ok(response.ok);
const room = await response.json() as { code: string; token: string };
const browsers = [await chromium.launch({ headless: true }), await webkit.launch({ headless: true })];
const pages: Page[] = [], errors: string[] = [];
let errorsTruncated=0;
const recordError=(message:string)=>{if(errors.length<1000)errors.push(message);else errorsTruncated++;};
let passed = false, start = 0, end = 0, failure: string | undefined;
let samples: TrafficSnapshot[] = [];
const windows: { file: string; sha256: string; start: number; end: number }[] = [];
const arrivalAges: number[][] = Array.from({ length: 6 }, () => []), speculation: number[][] = Array.from({ length: 6 }, () => []);
let windowStart = 0, completedMatches = 0;
const previousInputs = [0, 0, 0, 0, 0, 0];
const quantiles=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor((sorted.length-1)*.5)]??null,p95:sorted[Math.floor((sorted.length-1)*.95)]??null,p99:sorted[Math.floor((sorted.length-1)*.99)]??null,max:sorted.at(-1)??null};};
const snapshot = (page: Page) => page.evaluate(() => (globalThis as unknown as TrafficWindow).traffic.snapshot());
function assertSamples(samples: TrafficSnapshot[], windowStart: number): void {
  assert.ok(samples.every(s => s.round === 3 && s.phase === 'matchOver' && s.diagnostics.simulator && !s.diagnostics.recoveryRequired));
  assert.ok(samples.slice(0, 5).every(s => s.acceptedInputs > previousInputs[s.index]));
  assert.ok(samples.every(s=>s.network.overflow===0&&s.samplesTruncated===0),'No synthetic queue overflow or truncated measurements');
  assert.ok(samples.every(s=>!s.diagnostics.lastFault&&s.observations.every(o=>!o.lastFault&&!o.recoveryRequired)),'No automatic recovery hidden by subsequent success');
  if(profile!=='local')assert.ok(samples.reduce((n,s)=>n+s.network.fastDropped,0)>0,'Profile actually exercised fast message loss');
  for (const sample of samples) {
    assert.deepEqual(sample.outcome, samples[0].outcome, 'All six engines agree on finalized placements, leaderboard and match statistics');
    for (const round of [1, 2, 3]) assert.ok(sample.phases.some(p => p.at >= windowStart && p.round === round && p.phase === 'playing'), `Peer ${sample.index} played round ${round}`);
  }
  assert.ok(samples.every(s => !s.rx['ws:welcome'] && !s.rx['ws:peer'] && !s.tx['ws:signal']), 'No service reconnect, membership change or renegotiation during the measurement window');
  assert.ok(samples.every(s => !s.notices.some(n => n.at >= windowStart && /disconnected|failed|interrupted|timed out|membership changed|could not restore/i.test(n.text))), 'No hidden recovery during the measurement window');
  assert.deepEqual(errors, []);
}
try {
  for (let index = 0; index < 6; index++) {
    const context = await browsers[index % 2].newContext(), page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => { recordError(`${index}: ${error.stack ?? error.message}`); });
    page.on('console',message=>{if(message.type()==='error')recordError(`${index} console: ${message.text()}`);});
    await page.goto(new URL(`/traffic-fixture.html${index === 5 ? '?display=1' : ''}`, url).href);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ code, token, index,profile,seed }) => (globalThis as unknown as TrafficWindow).startTraffic(code, token, index,profile,seed), { code: room.code, token: index === 0 ? room.token : randomBytes(32).toString('hex'), index,profile,seed });
  }
  for (const page of pages) await page.waitForFunction(() => (globalThis as unknown as TrafficWindow).traffic.ready(), undefined, { timeout: 30_000 });
  start = Date.now() + 500; windowStart = start;
  await Promise.all(pages.map(page => page.evaluate(at => (globalThis as unknown as TrafficWindow).traffic.begin(at), start)));
  console.log(`Measuring ${durationSeconds ? `at least ${durationSeconds}s of repeated three-round matches` : 'a three-round match'}: five scripted player origins, six simulators, mixed Chromium/WebKit, real local WebRTC; ${profile} profile, seed ${seed}.`);
  const progress = setInterval(() => { void pages[0].evaluate(() => { const s = (globalThis as unknown as TrafficWindow).traffic.snapshot(); return { phase: s.phase, round: s.round, tick: s.tick, diagnostics: s.diagnostics }; }).then(s => console.log(JSON.stringify({ elapsed: (Date.now() - start) / 1000, completedMatches, ...s }))).catch(() => {}); }, 5000);
  try {
    while (true) {
    await Promise.all(pages.map(page => page.waitForFunction(() => {
      const s = (globalThis as unknown as TrafficWindow).traffic.snapshot();
      if (s.diagnostics.recoveryRequired) throw new Error('Game required recovery');
      return s.phase === 'matchOver';
    }, undefined, { timeout: 240_000 })));
    completedMatches++;
    if (!durationSeconds || Date.now() - start >= durationSeconds * 1000) break;
    const lap = await Promise.all(pages.map(page => page.evaluate(() => (globalThis as unknown as TrafficWindow).traffic.drain())));
    for (const sample of lap) {
      arrivalAges[sample.index].push(...sample.arrivals.map(a => a.receiverTick - a.tick));
      speculation[sample.index].push(...sample.observations.filter(o => !o.barrier && o.tick !== null && o.finalized !== undefined).map(o => o.tick! - o.finalized!));
    }
    const file = `direct-traffic-${run}-match-${String(completedMatches).padStart(3, '0')}.json.gz`;
    const bytes = gzipSync(JSON.stringify(lap)); await writeFile(`artifacts/${file}`, bytes);
    windows.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), start: windowStart, end: Date.now() });
    assertSamples(lap, windowStart);
    for (const sample of lap) previousInputs[sample.index] = sample.acceptedInputs;
    windowStart = Date.now();
    assert.equal(await pages[0].evaluate(() => (globalThis as unknown as TrafficWindow).traffic.rematch()), true);
    await Promise.all(pages.map(page => page.waitForFunction(() => {
      const s = (globalThis as unknown as TrafficWindow).traffic.snapshot();
      if (s.diagnostics.recoveryRequired) throw new Error('Rematch required recovery');
      return s.phase !== 'matchOver';
    }, undefined, { timeout: 30_000 })));
    }
  } finally { clearInterval(progress); }
  end = Date.now() + 250;
  await Promise.all(pages.map(page => page.evaluate(at => (globalThis as unknown as TrafficWindow).traffic.finish(at), end)));
  await pages[0].waitForTimeout(300);
  samples = await Promise.all(pages.map(snapshot));
  assertSamples(samples, windowStart);
  passed = true;
} catch (error) { failure = String(error); throw error; }
finally {
  if (!samples.length) samples = await Promise.all(pages.map(page => snapshot(page).catch(() => undefined))).then(all => all.filter((s): s is TrafficSnapshot => !!s));
  const cancelledQueueBytes=await Promise.all(pages.map(page=>page.evaluate(()=>(globalThis as unknown as TrafficWindow).traffic?.stop()).catch(()=>null)));
  await Promise.all(browsers.map(browser => browser.close()));
  const seconds = end > start ? (end - start) / 1000 : undefined;
  const totals = samples.map(s => {
    const sum = (direction: 'tx' | 'rx', prefix: string) => Object.entries(s[direction]).filter(([key]) => key.startsWith(prefix)).reduce((n, [, count]) => n + count.bytes, 0);
    return { index: s.index, actionArrivalAgeTicks:quantiles([...arrivalAges[s.index], ...s.arrivals.map(a=>a.receiverTick-a.tick)]), speculationTicks:quantiles([...speculation[s.index], ...s.observations.filter(o=>!o.barrier&&o.tick!==null&&o.finalized!==undefined).map(o=>o.tick!-o.finalized!)]), network:s.network, engine: s.index % 2 ? 'webkit' : 'chromium', rtcUpload: sum('tx', 'rtc:'), rtcDownload: sum('rx', 'rtc:'), signallingUpload: sum('tx', 'ws:'), signallingDownload: sum('rx', 'ws:'), rtcUploadBytesPerSecond: seconds ? sum('tx', 'rtc:') / seconds : null, rtcDownloadBytesPerSecond: seconds ? sum('rx', 'rtc:') / seconds : null };
  });
  const report = { durationSeconds, completedMatches, windows, errorsTruncated, cancelledQueueBytes, profile:directNetworkProfiles[profile], seed, impairmentMethod:'Seeded application-send queue enabled after room join. Delay/jitter and a shared aggregate sender bandwidth budget apply to both lanes. Reliable messages preserve per-channel ordering and are not dropped. Fast messages can drop/reorder. This does not model IP packets or SCTP retransmission. Synthetic unsent serialization bytes are included in native bufferedAmount; propagation-delayed entries stay memory-bounded but no longer count as unsent. Fast drops happen before serialization and consume no shaped bandwidth. Impairment continues through teardown to preserve FIFO; native byte counters use the declared start/end window, while queue stats include the short collection tail. Queued bytes at window end and cancelled bytes at stop are reported. Fixture queue bounds are 2048 messages and 512 KiB, overflow fails the run. First-arrival age uses the receiver simulation tick before application, deduplicated per alias/slot/sequence; it is not input-to-render latency. Samples are bounded and truncation fails the run.', revision, dirty, sourceHashes, bundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'), passed, failure, start, end, seconds, method: 'Real RoomRuntime and PeerTransport, five scripted human origins plus display, six simulators alternating Chromium/WebKit. Repeated three-round default-pickup matches when durationSeconds is nonzero; the same six contexts, WebRTC connections and runtime instances persist. Samples drain to hashed gzip files between matches; counters stay cumulative and quantiles include all windows. The final samples contain the last match. Measurement window starts before start command and includes countdowns, automatic round transitions and match completion. Native accepted-send and delivered-message application bytes classified for every RTC/WS payload. Excludes room-join bootstrap, HTTP requests/handshakes, SCTP/DTLS/IP headers, retransmission wire cost and rendering. Local native RTC with the declared application impairment profile. This workload is not matched to the historical five-bot serializer benchmark.', totals, samples, errors };
  await writeFile(`artifacts/direct-traffic-${run}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed, seconds, totals, failure, errors }, null, 2));
  await rm('dist/traffic-fixture.html', { force: true });
  assert.deepEqual(errors, [], 'No browser or teardown errors');
}
