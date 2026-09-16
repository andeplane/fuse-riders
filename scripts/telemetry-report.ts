// Summarises one room's device telemetry: npx tsx scripts/telemetry-report.ts artifacts/telemetry/<ROOM>.ndjson
// Every device posts its status changes, its inputs, its game events and once a second the runtime's own metrics
// (rollbacks, per-link round trips, stream gaps, snapshot requests, hash mismatches, the stall rule).
import { readFileSync } from 'node:fs';
type Event = Record<string, any> & { kind: string; device: { id: string; role: string; ua?: string }; wall: number; at: number };
const file = process.argv[2]; if (!file) { console.error('usage: telemetry-report <file.ndjson>'); process.exit(2); }
const events: Event[] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const pct = (values: number[], p: number) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : NaN; };
const ms = (n: number) => Number.isFinite(n) ? `${Math.round(n)} ms` : '—';
const byDevice = new Map<string, Event[]>();
for (const e of events) { const key = `${e.device.role}:${e.device.id}`; let list = byDevice.get(key); if (!list) byDevice.set(key, list = []); list.push(e); }
console.log(`${file}: ${events.length} events, ${byDevice.size} devices, ${((events.at(-1)!.wall - events[0]!.wall) / 1000).toFixed(0)} s\n`);
for (const [key, list] of byDevice) {
  const count = (kind: string) => list.filter(e => e.kind === kind).length;
  const metrics = list.filter(e => e.kind === 'metrics'), seconds = Math.max(1, (list.at(-1)!.wall - list[0]!.wall) / 1000);
  const first = metrics[0], last = metrics.at(-1);
  const rtts = metrics.flatMap(m => Object.values(m.rtt ?? {}) as number[]);
  const offsets = metrics.map(m => (m.clockTick as number) - (m.tick as number));
  const gaps = metrics.filter(m => Object.values(m.streams ?? {}).some(stream => (stream as { gap: boolean }).gap)).length;
  let snapshots = 0; for (let i = 1; i < metrics.length; i++) if (metrics[i]!.snapshotRequest && !metrics[i - 1]!.snapshotRequest) snapshots++;
  const stalls = metrics.filter(m => m.stall?.waitingFor !== undefined).length;
  console.log(`== ${key}  ${list[0]!.device.ua ?? ''}`);
  console.log(`   metrics ${metrics.length} samples over ${seconds.toFixed(0)} s · rtt p50 ${ms(pct(rtts, .5))} p95 ${ms(pct(rtts, .95))} max ${ms(Math.max(...rtts))} · clock ahead of fold p50 ${pct(offsets, .5).toFixed(1)} p95 ${pct(offsets, .95).toFixed(1)} ticks`);
  if (first && last) {
    const rollbacks = last.rollbacks - first.rollbacks, ticks = last.rollbackTicks - first.rollbackTicks;
    console.log(`   rollbacks ${rollbacks} (${(rollbacks / seconds * 60).toFixed(0)}/min, avg ${rollbacks ? (ticks / rollbacks).toFixed(1) : '0'} ticks) · samples with a gap ${gaps}/${metrics.length} · stalled ${stalls}/${metrics.length} · snapshot requests ${snapshots} · hash misses ${last.mismatches} · sent ${((last.sentBytes - first.sentBytes) / seconds / 1024).toFixed(1)} KB/s`);
    const rejected = Object.entries(last.streams ?? {}).map(([id, stream]) => [id, (stream as { rejected: number }).rejected] as const).filter(([, n]) => n > 0);
    if (rejected.length) console.log(`   rejected packets: ` + rejected.map(([id, n]) => `${id.slice(0, 6)} ${n}`).join(' · '));
  }
  console.log(`   inputs ${count('input')} · events ${count('event')}`);
  const statuses = list.filter(e => e.kind === 'status'); if (statuses.length) console.log(`   status changes (${statuses.length}): ` + statuses.slice(-8).map(e => `[${((e.wall - list[0]!.wall) / 1000).toFixed(0)}s] ${e.text}`).join(' | '));
  console.log();
}
