/** Bounded ICE restarts for one link. Attempts are numbered so a stale asynchronous completion cannot settle a newer attempt. */
export class LinkRestartPolicy {
  private count = 0;
  private current = 0;
  private inFlight = false;
  private dueAt: number;
  constructor(
    now: number,
    readonly max = 4,
    readonly intervalMs = 8000,
  ) {
    this.dueAt = now + intervalMs;
  }
  get attempts(): number {
    return this.count;
  }
  get exhausted(): boolean {
    return this.count >= this.max;
  }
  /** Fresh health restores the full budget; anything still in flight is stale. */
  healthy(now: number): void {
    if (this.inFlight || this.count) this.current++;
    this.count = 0;
    this.inFlight = false;
    this.dueAt = now + this.intervalMs;
  }
  due(now: number): boolean {
    return !this.exhausted && !this.inFlight && now >= this.dueAt;
  }
  begin(now: number): number {
    this.count++;
    this.inFlight = true;
    this.dueAt = now + this.intervalMs;
    return ++this.current;
  }
  /** Returns false when the attempt is no longer current; callers must not signal for it. */
  complete(attempt: number): boolean {
    if (attempt !== this.current) return false;
    this.inFlight = false;
    return true;
  }
}
