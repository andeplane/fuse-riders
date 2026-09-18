export const TICK_MS = 50;
export const SAMPLE_WINDOW_MS = 2000;
export const SLEW_TICKS_PER_SECOND = 1;
/** An offset this far out means the local clock was never close: snap instead of slewing for minutes. */
export const SNAP_TICKS = 200;
interface Sample {
  at: number;
  offset: number;
  rttMs: number;
}

/**
 * Fractional simulation time from an injected monotonic clock: `tick = base + (now − t0) · rate / 50` plus a slewed offset.
 * The time authority starts it and never adjusts it; followers feed lowest-RTT samples and slew at most one tick per
 * second. It never steps backwards, and a follower with no fresh sample free-runs rather than pausing.
 */
export class TickClock {
  private t0?: number;
  private base = 0;
  private offset = 0;
  private target = 0;
  private lastAdjust = 0;
  private lastTick = -Infinity;
  private samples: Sample[] = [];
  private pausedAt?: number;
  private scale = 1;
  constructor(private readonly now: () => number) {}
  get started(): boolean {
    return this.t0 !== undefined;
  }
  /** Authority start, or a follower's first estimate. */
  start(tick = 0): void {
    this.t0 = this.now();
    this.base = tick;
    this.offset = this.target = 0;
    this.lastAdjust = this.t0;
    this.lastTick = -Infinity;
    this.samples = [];
  }
  private raw(now: number): number {
    return this.base + ((now - (this.t0 ?? now)) * this.scale) / TICK_MS;
  }
  /**
   * Ticks per 50 ms from here on. Every member derives the same rate from the same world, so clocks change pace
   * within a round trip of each other and the usual slew absorbs the difference. Ticks already counted are kept.
   */
  get rate(): number {
    return this.scale;
  }
  set rate(scale: number) {
    if (scale === this.scale || !(scale > 0) || !Number.isFinite(scale)) return;
    if (this.t0 !== undefined) {
      const now = this.pausedAt ?? this.now();
      this.base = this.raw(now);
      this.t0 = now;
    }
    this.scale = scale;
  }
  /** Current fractional tick, monotonic across calls. */
  tick(): number {
    if (this.t0 === undefined) return 0;
    const now = this.pausedAt ?? this.now();
    if (this.offset !== this.target) {
      const budget =
        (Math.max(0, now - this.lastAdjust) / 1000) * SLEW_TICKS_PER_SECOND;
      this.offset += Math.max(
        -budget,
        Math.min(budget, this.target - this.offset),
      );
    }
    this.lastAdjust = now;
    const tick = Math.max(this.lastTick, this.raw(now) + this.offset);
    this.lastTick = tick;
    return tick;
  }
  /**
   * A follower sample: the authority's fractional tick when it sent a packet and the measured round trip. The
   * authority is assumed to be `rtt / 2` further along by the time the sample is read here.
   */
  sample(authorityTick: number, rttMs: number): void {
    if (!Number.isFinite(authorityTick) || !Number.isFinite(rttMs) || rttMs < 0)
      return;
    const now = this.now(),
      estimate = authorityTick + ((rttMs / 2) * this.scale) / TICK_MS;
    if (this.t0 === undefined) {
      this.start(estimate);
      return;
    }
    this.samples = this.samples.filter(
      (sample) => now - sample.at <= SAMPLE_WINDOW_MS,
    );
    this.samples.push({ at: now, offset: estimate - this.raw(now), rttMs });
    const best = this.samples.reduce((best, sample) =>
      sample.rttMs < best.rttMs ? sample : best,
    );
    if (Math.abs(best.offset - this.offset) > SNAP_TICKS) {
      this.offset = this.target = best.offset;
      return;
    }
    this.target = best.offset;
  }
  /** Solo pause while the page is hidden: time spent paused is removed from the clock on resume. */
  pause(): void {
    if (this.t0 !== undefined && this.pausedAt === undefined)
      this.pausedAt = this.now();
  }
  resume(): void {
    if (this.pausedAt !== undefined && this.t0 !== undefined) {
      this.t0 += this.now() - this.pausedAt;
      this.lastAdjust = this.now();
      this.pausedAt = undefined;
    }
  }
  diagnostics(): { offset: number; samples: number; bestRttMs?: number } {
    const best = this.samples.length
      ? Math.min(...this.samples.map((sample) => sample.rttMs))
      : undefined;
    return {
      offset: this.offset,
      samples: this.samples.length,
      ...(best === undefined ? {} : { bestRttMs: best }),
    };
  }
}
