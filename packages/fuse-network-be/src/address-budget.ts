/**
 * A token bucket per client address, kept in this process: for routes whose every call costs a room read whoever
 * the caller is, so that a caller who is nobody cannot buy reads without limit. It needs no database call of its own,
 * which is the point; the price is that each instance keeps its own count.
 *
 * Memory is bounded: a bucket idle long enough to be full again is forgotten, and past `maxKeys` live buckets a
 * new address is refused rather than tracked.
 */
export class AddressBudget {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly now: () => number,
    private readonly burst: number,
    private readonly perSecond: number,
    private readonly maxKeys = 10_000,
  ) {}
  /** Buckets held right now. */
  get size(): number {
    return this.buckets.size;
  }
  /** Spends one call of `address`'s allowance; false when it has none left. */
  take(address: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(address);
    // Re-inserting keeps the map oldest-first, so the sweep stops at the first bucket still in use.
    this.buckets.delete(address);
    for (const [other, idle] of this.buckets)
      if (now - idle.at >= (this.burst / this.perSecond) * 1000)
        this.buckets.delete(other);
      else break;
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) return false;
      bucket = { tokens: this.burst, at: now };
    }
    bucket.tokens = Math.min(
      this.burst,
      bucket.tokens + (Math.max(0, now - bucket.at) * this.perSecond) / 1000,
    );
    bucket.at = now;
    this.buckets.set(address, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
