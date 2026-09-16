import type { RuntimeMetrics } from './room-runtime.js';
/** Link quality over the last few seconds, as a phone or TV shows it: what the mesh is doing now, not a lifetime average. */
export const STATS_WINDOW_MS = 10_000;
export interface NetSummary {
  rttP50?: number; rttP95?: number;   // ms, over every peer link's latest echo in the window
  peers: number;                      // links with a measured round trip
  rollbacksPerMin: number; rollbackAvgTicks: number;
  gapShare: number;                   // fraction of the window some stream was waiting on a repair
  snapshotsPerMin: number;            // snapshot requests started
  mismatches: number;                 // hash mismatches in the runtime's divergence window
  clockOffsetTicks: number;           // local clock minus the folded tick
  waitingFor?: string;                // the rider the stall rule is waiting on right now
  silenceMs: number;                  // since any peer was last heard
}
export type NetVerdict = { grade: 'good' | 'fair' | 'bad'; reason: string };
interface Sample { at: number; rtts: number[]; rollbacks: number; rollbackTicks: number; gap: boolean; snapshot: boolean; mismatches: number; offset: number; waitingFor?: string; silenceMs: number }

export class NetStats {
  private readonly samples: Sample[] = [];
  constructor(private readonly now: () => number) {}
  /** Called on a fixed cadence with the runtime's current metrics; rates come from the deltas inside the window. */
  record(m: RuntimeMetrics): void {
    const at = this.now(), heard = Object.values(m.heard);
    this.samples.push({ at, rtts: Object.values(m.rtt), rollbacks: m.rollbacks, rollbackTicks: m.rollbackTicks, gap: Object.values(m.streams).some(stream => stream.gap), snapshot: m.snapshotRequest, mismatches: m.mismatches, offset: m.clockTick - m.tick, waitingFor: m.stall.waitingFor, silenceMs: heard.length ? Math.min(...heard) : Infinity });
    const horizon = at - STATS_WINDOW_MS; let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.at < horizon) drop++;
    if (drop) this.samples.splice(0, drop);
  }
  reset(): void { this.samples.length = 0; }
  summary(): NetSummary {
    const recent = this.samples, first = recent[0], last = recent.at(-1);
    if (!first || !last) return { peers: 0, rollbacksPerMin: 0, rollbackAvgTicks: 0, gapShare: 0, snapshotsPerMin: 0, mismatches: 0, clockOffsetTicks: 0, silenceMs: Infinity };
    const minutes = STATS_WINDOW_MS / 60_000;
    const rtts = recent.flatMap(sample => sample.rtts).sort((a, b) => a - b);
    const percentile = (p: number) => rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))] : undefined;
    const rollbacks = Math.max(0, last.rollbacks - first.rollbacks), rollbackTicks = Math.max(0, last.rollbackTicks - first.rollbackTicks);
    let snapshots = 0; for (let index = 1; index < recent.length; index++) if (recent[index]!.snapshot && !recent[index - 1]!.snapshot) snapshots++;
    return {
      ...(rtts.length ? { rttP50: percentile(0.5), rttP95: percentile(0.95) } : {}),
      peers: last.rtts.length,
      rollbacksPerMin: rollbacks / minutes, rollbackAvgTicks: rollbacks ? rollbackTicks / rollbacks : 0,
      gapShare: recent.filter(sample => sample.gap).length / recent.length,
      snapshotsPerMin: snapshots / minutes, mismatches: last.mismatches, clockOffsetTicks: last.offset,
      ...(last.waitingFor === undefined ? {} : { waitingFor: last.waitingFor }), silenceMs: last.silenceMs,
    };
  }
}

/** One line the player can act on: is it the Wi-Fi, another rider, or the game. */
export function verdict(s: NetSummary): NetVerdict {
  if (s.silenceMs > 1000) return { grade: 'bad', reason: s.silenceMs === Infinity ? 'no packets from the riders yet' : `riders silent for ${(s.silenceMs / 1000).toFixed(1)} s` };
  if (s.mismatches >= 3 || s.snapshotsPerMin > 6) return { grade: 'bad', reason: 'simulation keeps re-syncing' };
  if ((s.rttP95 ?? 0) > 250 || s.gapShare > 0.5 || s.waitingFor !== undefined) return { grade: 'bad', reason: s.waitingFor ? `waiting for ${s.waitingFor}` : 'packet loss or lag on the link' };
  if ((s.rttP95 ?? 0) > 120 || s.rollbackAvgTicks >= 6 || s.gapShare > 0.1) return { grade: 'fair', reason: 'link is jittery' };
  return { grade: 'good', reason: 'link is healthy' };
}

/** The overlay text: fixed order so the eye can compare frames. */
export function formatNetStats(s: NetSummary, path: string): string {
  const v = verdict(s), ms = (n?: number) => n === undefined ? '—' : `${Math.round(n)} ms`;
  return [
    `link ${v.grade.toUpperCase()} · ${v.reason}`,
    `path ${path} · ${s.peers} peers · rtt ${ms(s.rttP50)} / p95 ${ms(s.rttP95)}`,
    `silence ${s.silenceMs === Infinity ? '—' : `${Math.round(s.silenceMs)} ms`} · gaps ${Math.round(s.gapShare * 100)}% of the window`,
    `rollbacks ${s.rollbacksPerMin.toFixed(0)}/min · avg ${s.rollbackAvgTicks.toFixed(1)} ticks · snapshots ${s.snapshotsPerMin.toFixed(0)}/min`,
    `hash misses ${s.mismatches} · ${s.waitingFor ? `stalled on ${s.waitingFor}` : 'no stall'}`,
    `clock ${s.clockOffsetTicks > 0 ? '+' : ''}${s.clockOffsetTicks.toFixed(1)} ticks ahead of the fold`,
  ].join('\n');
}
