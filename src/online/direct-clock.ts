import { uint32, UINT32_MAX } from '../shared/direct-input.js';
import { DIRECT_VERSION } from './direct-stream.js';

export const MAX_CLOCK_UNCERTAINTY_TICKS = 5;
export const CLOCK_FRESH_MS = 2500;
/** Supported relative oscillator drift; physical-device qualification remains pending. */
export const CLOCK_DRIFT_TICKS_PER_MS = 0.00001;
export const MAX_ORIGIN_LEAD_TICKS = 4;
export const FUTURE_RECORD_TICKS = 2 * MAX_CLOCK_UNCERTAINTY_TICKS + MAX_ORIGIN_LEAD_TICKS;

export type ClockProbe = [version: 1, segment: number, kind: 'clock', id: number];
export type ClockReply = [version: 1, segment: number, kind: 'time', id: number, tick: number];
export interface DirectClockReading {
  tick: number; fractionalTick: number; canAdvance: boolean; canOriginate: boolean;
  reason: 'ready' | 'waiting' | 'sampling' | 'uncertain' | 'stale' | 'clock-jump' | 'discrepancy' | 'exhausted';
  uncertaintyTicks: number;
}
interface Sample { at: number; midpoint: number; rtt: number }
const projected = (sample: Sample, now: number) => sample.midpoint + (now - sample.at) / 50;
const radius = (sample: Sample, now: number) => sample.rtt / 100 + (sample.rtt + now - sample.at) * CLOCK_DRIFT_TICKS_PER_MS;

/** Independent segment time. Network replies tune the clock; they never step the world. */
export class DirectTickClock {
  private lastObserved: number;
  private value?: number;
  private started = false;
  private uncertaintyTicks = 0;
  private lastValid = -Infinity;
  private nextId = 0;
  private lastAccepted = 0;
  private pending = new Map<number, number>();
  private samples: Sample[] = [];
  private fault?: 'clock-jump' | 'discrepancy' | 'exhausted';
  private constructor(readonly segment: number, readonly baseTick: number, private readonly now: () => number, private readonly leader: boolean, startAt?: number, source?: DirectTickClock) {
    if (source) {
      this.lastObserved = source.lastObserved; this.value = source.value; this.started = source.started;
      this.uncertaintyTicks = source.uncertaintyTicks; this.lastValid = source.lastValid; this.nextId = source.nextId; this.lastAccepted = source.lastAccepted;
      this.pending = new Map(source.pending); this.samples = [...source.samples]; this.fault = source.fault;
      return;
    }
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
    this.uncertaintyTicks += this.leader ? 0 : elapsed * CLOCK_DRIFT_TICKS_PER_MS;
    this.samples = this.samples.filter(s => at - s.at <= CLOCK_FRESH_MS);
    if (this.value !== undefined) {
      const baseline = this.value + elapsed / 50;
      const best = this.best(at);
      const error = best ? projected(best, at) - baseline : 0;
      this.value = baseline + Math.max(-elapsed / 1000, Math.min(elapsed / 1000, error));
      if (this.value > UINT32_MAX) this.fault = 'exhausted';
      if (this.leader && this.value >= this.baseTick) this.started = true;
    }
    this.lastObserved = at; this.rememberUncertainty(at);
    for (const [id, sent] of this.pending) if (at - sent > 500) this.pending.delete(id);
    return at;
  }
  private best(at: number): Sample | undefined { return this.samples.reduce<Sample | undefined>((best, s) => !best || radius(s, at) < radius(best, at) ? s : best, undefined); }

  private rememberUncertainty(at: number): void {
    const best = this.best(at);
    if (best) this.uncertaintyTicks = radius(best, at) + Math.abs(projected(best, at) - Math.max(this.baseTick, this.value ?? this.baseTick));
  }

  read(activeControls = false): DirectClockReading {
    const at = this.observe();
    const fractionalTick = Math.max(this.baseTick, this.value ?? this.baseTick);
    const fresh = this.leader || at - this.lastValid <= CLOCK_FRESH_MS;
    const uncertaintyTicks = this.uncertaintyTicks;
    const uncertain = uncertaintyTicks > MAX_CLOCK_UNCERTAINTY_TICKS;
    const reason = this.fault ?? (this.value === undefined ? 'sampling' : !this.started ? 'waiting' : uncertain ? 'uncertain' : !fresh ? 'stale' : 'ready');
    return { tick: Math.floor(fractionalTick), fractionalTick, canOriginate: reason === 'ready', canAdvance: !this.fault && !uncertain && this.started && (fresh || !activeControls), reason, uncertaintyTicks };
  }
  /** An external nonce binds the sample to its enclosing heartbeat attempt. */
  request(nonce?: number): ClockProbe | undefined {
    const at = this.observe();
    if (this.leader || this.fault) return;
    if (this.nextId === UINT32_MAX) { this.fault = 'exhausted'; return; }
    const id = nonce ?? this.nextId + 1;
    if (!uint32(id) || id <= this.nextId) return;
    this.nextId = id; this.pending.set(id, at);
    while (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value!);
    return [DIRECT_VERSION, this.segment, 'clock', id];
  }
  reply(raw: unknown): ClockReply | undefined {
    this.observe();
    if (!this.leader || this.fault || !Array.isArray(raw) || raw.length !== 4 || raw[0] !== DIRECT_VERSION || raw[1] !== this.segment || raw[2] !== 'clock' || !uint32(raw[3]) || !raw[3]) return;
    return [DIRECT_VERSION, this.segment, 'time', raw[3], this.value!];
  }
  /** A combined message can reject its other fields without consuming this clock sample. */
  prepare(raw: unknown): { clock: DirectTickClock; status: 'accepted' | 'invalid' | 'stale' | 'fault' } {
    const clock = new DirectTickClock(this.segment, this.baseTick, this.now, this.leader, undefined, this);
    return { clock, status: clock.accept(raw) };
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
    const previous = this.best(at);
    const difference = previous ? Math.abs(projected(previous, at) - sample.midpoint) - radius(previous, at) - radius(sample, at)
      : this.value === undefined ? 0 : Math.abs(this.value - sample.midpoint) - radius(sample, at);
    if (difference > 4) { this.fault = 'discrepancy'; return 'fault'; }
    this.samples.push(sample);
    if (this.samples.length > 8) this.samples.shift();
    this.value ??= sample.midpoint;
    this.lastAccepted = raw[3]; this.lastValid = at; this.rememberUncertainty(at);
    if (raw[4] >= this.baseTick) this.started = true;
    return 'accepted';
  }
}
