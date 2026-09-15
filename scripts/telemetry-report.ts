// Summarises one room's device telemetry: npx tsx scripts/telemetry-report.ts artifacts/telemetry/<ROOM>.ndjson
import { readFileSync } from 'node:fs';
type Event = Record<string, any> & { kind: string; device: { id: string; role: string; ua?: string }; wall: number; at: number };
const file = process.argv[2]; if (!file) { console.error('usage: telemetry-report <file.ndjson>'); process.exit(2); }
const events: Event[] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const pct = (values: number[], p: number) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : NaN; };
const ms = (n: number) => Number.isFinite(n) ? `${Math.round(n)} ms` : '—';
const byDevice = new Map<string, Event[]>();
for (const e of events) { const key = `${e.device.role}:${e.device.id}`; let list = byDevice.get(key); if (!list) byDevice.set(key, list = []); list.push(e); }
const hosts = events.filter(e => e.device.role === 'host' && e.kind === 'ingest');
console.log(`${file}: ${events.length} events, ${byDevice.size} devices, ${((events.at(-1)!.wall - events[0]!.wall) / 1000).toFixed(0)} s\n`);
for (const [key, list] of byDevice) {
  const count = (kind: string) => list.filter(e => e.kind === kind).length;
  // A controller phone sees heartbeats, not stream packets; both carry the link's rtt and the host tick.
  const recv = list.filter(e => e.kind === 'recv' || e.kind === 'heartbeat'), rtts = recv.map(e => e.rtt).filter((r): r is number => typeof r === 'number');
  const seconds = Math.max(1, (list.at(-1)!.wall - list[0]!.wall) / 1000);
  console.log(`== ${key}  ${list[0]!.device.ua ?? ''}`);
  console.log(`   recv ${(recv.length / seconds).toFixed(1)}/s · rtt p50 ${ms(pct(rtts, .5))} p95 ${ms(pct(rtts, .95))} max ${ms(Math.max(...rtts))} · clock offset p50 ${(pct(recv.map(e => e.clock - e.tick), .5)).toFixed(1)} ticks`);
  console.log(`   inputs ${count('input')} · sends ${count('send')} · gaps ${count('gap')} · repairs ${count('repair')} · invalid ${count('invalid')} · resyncs ${count('resync')} · baselines ${count('baseline')} (refused ${list.filter(e => e.kind === 'baseline' && e.refused).length}) · rewinds ${count('rewind')} (max ${Math.max(0, ...list.filter(e => e.kind === 'rewind').map(e => e.depth))}) · mismatches ${count('mismatch')}`);
  if (list[0]!.device.role === 'host') {
    const ingests = list.filter(e => e.kind === 'ingest'), missing = ingests.filter(e => e.firstMissing !== undefined);
    console.log(`   host: ingests ${ingests.length} · with gap ${missing.length} · absent ${count('absent')} · resync requests ${count('resync-in')}`);
  } else {
    // Input to fold: the guest stamps seq at wall time; the host's first ingest whose lastSeq covers it is when it folded. Clocks are the devices' own.
    const inputs = list.filter(e => e.kind === 'input'), latencies: number[] = [];
    for (const input of inputs) { const folded = hosts.find(h => h.from === list[0]!.device.id && h.lastSeq >= input.seq && h.wall >= input.wall); if (folded) latencies.push(folded.wall - input.wall); }
    console.log(`   input→host fold (wall clocks): p50 ${ms(pct(latencies, .5))} p95 ${ms(pct(latencies, .95))} · unmatched ${inputs.length - latencies.length}`);
    // Stream freshness: how far the host's relayed streams lag this device's own clock.
    const lag = recv.map(e => e.clock - e.tick); console.log(`   host tick behind local clock: p50 ${pct(lag, .5).toFixed(1)} p95 ${pct(lag, .95).toFixed(1)} ticks`);
  }
  const statuses = list.filter(e => e.kind === 'status'); if (statuses.length) console.log(`   status changes (${statuses.length}): ` + statuses.slice(-8).map(e => `[${((e.wall - list[0]!.wall) / 1000).toFixed(0)}s] ${e.text}`).join(' | '));
  const trouble = list.filter(e => ['gap', 'invalid', 'resync', 'baseline', 'mismatch', 'absent'].includes(e.kind));
  if (trouble.length) console.log(`   trouble timeline: ` + trouble.slice(0, 30).map(e => `[${((e.wall - list[0]!.wall) / 1000).toFixed(1)}s] ${e.kind}${e.refused ? `(${e.refused})` : ''}${e.member ? ` ${String(e.member).slice(0, 6)}` : ''}`).join(' · ') + (trouble.length > 30 ? ` … +${trouble.length - 30}` : ''));
  console.log();
}
