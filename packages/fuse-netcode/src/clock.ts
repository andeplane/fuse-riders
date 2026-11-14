export const TICK_MS = 50;
export const SAMPLE_WINDOW_MS = 2000;
export const SLEW_TICKS_PER_SECOND = 1;
/**
 * Once a follower has locked onto the authority, the slew below the cap is proportional to the error, closing it with
 * this time constant; the first lock after a start still runs at the full rate, so a joiner is in step within moments. A jittery link moves the
 * best sample by a few milliseconds every time the window turns over, and correcting each of those at the full rate
 * made a follower's game run visibly fast and slow (up to 5%) for a fraction of a second.
 */
export const SLEW_SETTLE_MS = 2000;
/** The slowest slew, in milliseconds of game time per second, so a small error closes in finite time. */
export const SLEW_FLOOR_MS_PER_SECOND = 1;
/** An offset this far out means the local clock was never close: snap instead of slewing for minutes. */
export const SNAP_TICKS = 200;
interface Sample {
  at: number;
  offset: number;
  rttMs: number;
}

/**
 * Fractional log time from an injected monotonic clock: `tick = base + (now − t0) / TICK_MS` plus a slewed offset. It
 * has one rate: a game that runs faster runs more simulation steps per tick (`driveGameTick`), not a faster clock.
 * The time authority starts it and never adjusts it; followers feed lowest-RTT samples and slew at most one tick per
 * second, and more gently the closer they already are. It never steps backwards, and a follower with no fresh sample free-runs rather than pausing.
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
  /** Whether the offset has reached its target once since the clock started: the first lock runs at the full rate. */
  private locked = false;
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
    this.locked = false;
  }
  private raw(now: number): number {
    return this.base + (now - (this.t0 ?? now)) / TICK_MS;
  }
  /** Current fractional tick, monotonic across calls. */
  tick(): number {
    if (this.t0 === undefined) return 0;
    const now = this.pausedAt ?? this.now();
    if (this.offset !== this.target) {
      const rate = this.locked
          ? Math.min(
              SLEW_TICKS_PER_SECOND,
              Math.max(
                SLEW_FLOOR_MS_PER_SECOND / TICK_MS,
                (Math.abs(this.target - this.offset) * 1000) / SLEW_SETTLE_MS,
              ),
            )
          : SLEW_TICKS_PER_SECOND,
        budget = (Math.max(0, now - this.lastAdjust) / 1000) * rate;
      this.offset += Math.max(
        -budget,
        Math.min(budget, this.target - this.offset),
      );
      if (this.offset === this.target) this.locked = true;
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
      estimate = authorityTick + rttMs / 2 / TICK_MS;
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
