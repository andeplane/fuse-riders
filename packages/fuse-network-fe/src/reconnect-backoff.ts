/** The first wait, as it has always been: a dropped socket is back within a second or two. */
export const RECONNECT_BASE_MS = 1_500;
/** The longest wait after a drop or an operational refusal; none of those is charged to anyone. */
export const RECONNECT_CAP_MS = 30_000;
/**
 * The longest wait while the service keeps refusing the handshake (close 4401). Each of those spends the hourly
 * failure budget (30) that everyone behind this page's address shares, so the ladder is long enough that one page
 * refused for a whole hour spends about 21 of them and cannot lock its own network out by itself.
 */
export const RECONNECT_REFUSED_CAP_MS = 300_000;

/**
 * How long to wait before reopening the room socket: doubling from 1.5 s while no attempt has been welcomed, with
 * jitter so the pages a restart dropped together do not come back together. A welcome resets it. The policy owns no
 * timer and no clock; the random source is injected.
 */
export class ReconnectBackoff {
  private failures = 0;
  /** `random` returns [0, 1), like `Math.random`. */
  constructor(private readonly random: () => number) {}
  /** Attempts since the last welcome that ended without one. */
  get attempts(): number {
    return this.failures;
  }
  /** The wait before the next attempt, in [¾, 1] of the current step. `refused`: the service closed with 4401. */
  next(refused: boolean): number {
    const step = Math.min(
      refused ? RECONNECT_REFUSED_CAP_MS : RECONNECT_CAP_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(this.failures, 20),
    );
    this.failures++;
    return Math.round(step * (1 - 0.25 * this.random()));
  }
  /** The service welcomed this page: the next drop starts from the first step again. */
  reset(): void {
    this.failures = 0;
  }
}
