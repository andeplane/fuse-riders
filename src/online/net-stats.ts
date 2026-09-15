/** Link quality over the last few seconds, as a phone or TV shows it: what the link is doing now, not a lifetime average. */
export const STATS_WINDOW_MS = 10_000;
export type NetEvent = 'packet' | 'repair' | 'gap' | 'rewind' | 'resync' | 'mismatch';
export interface NetSummary {
  rttP50?: number; rttP95?: number;   // ms, from echoed send times on the host link
  packetsPerSec: number;              // host packets that arrived
  repairsPerMin: number; gapsPerMin: number; rewindsPerMin: number; rewindMax: number; resyncsPerMin: number; mismatches: number;
  clockOffsetTicks?: number;          // local clock minus the host's last stamp
  silenceMs: number;                  // since the host was last heard
}
export type NetVerdict = { grade: 'good' | 'fair' | 'bad'; reason: string };

export class NetStats {
  private readonly events: { at: number; kind: NetEvent; value: number }[] = [];
  private heardAt = -Infinity;
  clockOffsetTicks?: number;
  constructor(private readonly now: () => number) {}
  /** `value` is the RTT for a packet and the depth for a rewind. */
  record(kind: NetEvent, value = 0): void {
    const at = this.now();
    if (kind === 'packet') this.heardAt = at;
    this.events.push({ at, kind, value });
    const horizon = at - STATS_WINDOW_MS; let drop = 0;
    while (drop < this.events.length && this.events[drop]!.at < horizon) drop++;
    if (drop) this.events.splice(0, drop);
  }
  reset(): void { this.events.length = 0; this.heardAt = -Infinity; this.clockOffsetTicks = undefined; }
  summary(): NetSummary {
    const now = this.now(), horizon = now - STATS_WINDOW_MS, recent = this.events.filter(e => e.at >= horizon);
    const minutes = STATS_WINDOW_MS / 60_000, seconds = STATS_WINDOW_MS / 1000;
    const rtts = recent.filter(e => e.kind === 'packet' && e.value > 0).map(e => e.value).sort((a, b) => a - b);
    const count = (kind: NetEvent) => recent.filter(e => e.kind === kind).length;
    const percentile = (p: number) => rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))] : undefined;
    return {
      ...(rtts.length ? { rttP50: percentile(0.5), rttP95: percentile(0.95) } : {}),
      packetsPerSec: count('packet') / seconds,
      repairsPerMin: count('repair') / minutes, gapsPerMin: count('gap') / minutes,
      rewindsPerMin: count('rewind') / minutes, rewindMax: Math.max(0, ...recent.filter(e => e.kind === 'rewind').map(e => e.value)),
      resyncsPerMin: count('resync') / minutes, mismatches: count('mismatch'),
      ...(this.clockOffsetTicks === undefined ? {} : { clockOffsetTicks: this.clockOffsetTicks }),
      silenceMs: this.heardAt === -Infinity ? Infinity : now - this.heardAt,
    };
  }
}

/** One line the player can act on: is it the Wi-Fi, the host, or the game. */
export function verdict(s: NetSummary): NetVerdict {
  if (s.silenceMs > 1000) return { grade: 'bad', reason: s.silenceMs === Infinity ? 'no packets from the host yet' : `host silent for ${(s.silenceMs / 1000).toFixed(1)} s` };
  if (s.resyncsPerMin > 6 || s.mismatches >= 3) return { grade: 'bad', reason: 'simulation keeps re-syncing' };
  if ((s.rttP95 ?? 0) > 250 || s.gapsPerMin > 30) return { grade: 'bad', reason: 'packet loss or lag on the link' };
  if ((s.rttP95 ?? 0) > 120 || s.repairsPerMin > 12 || s.rewindMax >= 8) return { grade: 'fair', reason: 'link is jittery' };
  return { grade: 'good', reason: 'link is healthy' };
}

/** The overlay text: fixed order so the eye can compare frames. */
export function formatNetStats(s: NetSummary, path: string): string {
  const v = verdict(s), ms = (n?: number) => n === undefined ? '—' : `${Math.round(n)} ms`;
  return [
    `link ${v.grade.toUpperCase()} · ${v.reason}`,
    `path ${path} · rtt ${ms(s.rttP50)} / p95 ${ms(s.rttP95)}`,
    `packets ${s.packetsPerSec.toFixed(1)}/s · silence ${s.silenceMs === Infinity ? '—' : `${Math.round(s.silenceMs)} ms`}`,
    `gaps ${s.gapsPerMin.toFixed(0)}/min · repairs ${s.repairsPerMin.toFixed(0)}/min · resyncs ${s.resyncsPerMin.toFixed(0)}/min`,
    `rewinds ${s.rewindsPerMin.toFixed(0)}/min · deepest ${s.rewindMax} ticks · hash misses ${s.mismatches}`,
    `clock ${s.clockOffsetTicks === undefined ? '—' : `${s.clockOffsetTicks > 0 ? '+' : ''}${s.clockOffsetTicks.toFixed(1)} ticks`}`,
  ].join('\n');
}
