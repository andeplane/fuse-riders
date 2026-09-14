import { uint32, UINT32_MAX } from '../shared/direct-input.js';
import { DIRECT_VERSION } from './direct-stream.js';

export type ClockProbe = [version: 1, segment: number, kind: 'clock', id: number];
export type ClockReply = [version: 1, segment: number, kind: 'time', id: number, tick: number];
export interface DirectClockReading {
  tick: number; fractionalTick: number; canAdvance: boolean; canOriginate: boolean;
  reason: 'ready' | 'waiting' | 'sampling' | 'stale' | 'clock-jump' | 'discrepancy' | 'exhausted';
  uncertaintyTicks: number;
}
interface Sample { at: number; midpoint: number; rtt: number }
const projected = (sample: Sample, now: number) => sample.midpoint + (now - sample.at) / 50;
const radius = (sample: Sample) => sample.rtt / 100;

/** Independent segment time. Network replies tune the clock; they never step the world. */
export class DirectTickClock {
  private lastObserved: number;
  private value?: number;
  private started = false;
  private lastValid = -Infinity;
  private nextId = 0;
  private lastAccepted = 0;
  private pending = new Map<number, number>();
  private samples: Sample[] = [];
  private fault?: 'clock-jump' | 'discrepancy' | 'exhausted';
  private constructor(readonly segment: number, readonly baseTick: number, private readonly now: () => number, private readonly leader: boolean, startAt?: number) {
    const at = now();
    if (!uint32(segment) || segment === 0 || !uint32(baseTick) || !Number.isFinite(at) || at < 0) throw new Error('Invalid clock scope');
    this.lastObserved = at;
    if (leader) {
      if (!Number.isFinite(startAt) || startAt! < at || startAt! > at + 1000) throw new Error('Invalid segment start');
      this.value = baseTick + (at - startAt!) / 50;
    }
  }
  static coordinator(segment: number, baseTick: number, now: () => number, startAt: number): DirectTickClock { return new DirectTickClock(segment, baseTick, now, true, startAt); }
  static follower(segment: number, baseTick: number, now: () => number): DirectTickClock { return new DirectTickClock(segment, baseTick, now, false); }
  get outstandingProbes(): number { return this.pending.size; }

  private observe(): number {
    const at = this.now(), elapsed = at - this.lastObserved;
    if (!Number.isFinite(at) || elapsed < 0 || elapsed > 1000) this.fault ??= 'clock-jump';
    if (this.fault) return this.lastObserved;
    this.samples = this.samples.filter(s => at - s.at <= 1000);
    if (this.value !== undefined) {
      const baseline = this.value + elapsed / 50;
      const best = this.best();
      const error = best ? projected(best, at) - baseline : 0;
      this.value = baseline + Math.max(-elapsed / 1000, Math.min(elapsed / 1000, error));
      if (this.value > UINT32_MAX) this.fault = 'exhausted';
      if (this.leader && this.value >= this.baseTick) this.started = true;
    }
    this.lastObserved = at;
    for (const [id, sent] of this.pending) if (at - sent > 500) this.pending.delete(id);
    return at;
  }
  private best(): Sample | undefined { return this.samples.reduce<Sample | undefined>((best, s) => !best || s.rtt < best.rtt ? s : best, undefined); }

  read(activeControls = false): DirectClockReading {
    const at = this.observe(), best = this.best();
    const fractionalTick = Math.max(this.baseTick, this.value ?? this.baseTick);
    const fresh = this.leader || at - this.lastValid <= 1000;
    const reason = this.fault ?? (this.value === undefined ? 'sampling' : !this.started ? 'waiting' : !fresh ? 'stale' : 'ready');
    return { tick: Math.floor(fractionalTick), fractionalTick, canOriginate: reason === 'ready', canAdvance: !this.fault && this.started && (fresh || !activeControls), reason, uncertaintyTicks: best ? radius(best) + Math.abs(projected(best, at) - fractionalTick) : 0 };
  }
  request(): ClockProbe | undefined {
    const at = this.observe();
    if (this.leader || this.fault) return;
    if (this.nextId === UINT32_MAX) { this.fault = 'exhausted'; return; }
    const id = ++this.nextId; this.pending.set(id, at);
    while (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value!);
    return [DIRECT_VERSION, this.segment, 'clock', id];
  }
  reply(raw: unknown): ClockReply | undefined {
    this.observe();
    if (!this.leader || this.fault || !Array.isArray(raw) || raw.length !== 4 || raw[0] !== DIRECT_VERSION || raw[1] !== this.segment || raw[2] !== 'clock' || !uint32(raw[3]) || !raw[3]) return;
    return [DIRECT_VERSION, this.segment, 'time', raw[3], this.value!];
  }
  accept(raw: unknown): 'accepted' | 'invalid' | 'stale' | 'fault' {
    const at = this.observe();
    if (this.fault) return 'fault';
    if (this.leader || !Array.isArray(raw) || raw.length !== 5 || raw[0] !== DIRECT_VERSION || raw[1] !== this.segment || raw[2] !== 'time' || !uint32(raw[3]) || typeof raw[4] !== 'number' || !Number.isFinite(raw[4]) || raw[4] < this.baseTick - 20 || raw[4] > UINT32_MAX) return 'invalid';
    const sent = this.pending.get(raw[3]);
    if (sent === undefined) return 'stale';
    this.pending.delete(raw[3]);
    if (raw[3] <= this.lastAccepted) return 'stale';
    const sample: Sample = { at, midpoint: raw[4] + (at - sent) / 100, rtt: at - sent };
    const previous = this.best();
    const difference = previous ? Math.abs(projected(previous, at) - sample.midpoint) - radius(previous) - radius(sample)
      : this.value === undefined ? 0 : Math.abs(this.value - sample.midpoint) - radius(sample);
    if (difference > 4) { this.fault = 'discrepancy'; return 'fault'; }
    this.samples.push(sample);
    if (this.samples.length > 8) this.samples.shift();
    this.value ??= sample.midpoint;
    this.lastAccepted = raw[3]; this.lastValid = at;
    if (raw[4] >= this.baseTick) this.started = true;
    return 'accepted';
  }
}
