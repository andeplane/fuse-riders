/** Path-specific probe acknowledgements; socket readiness never proves delivery. */
export class LinkHealth {
  private nextId = 0;
  private pending = new Map<number, number>();
  private lastAck = -Infinity;
  private consecutive = 0;
  private unhealthySince: number | undefined;
  constructor(now: number) { this.unhealthySince = now; }
  probe(now: number): number {
    for (const [id, at] of this.pending) if (now - at > 600) this.pending.delete(id);
    const id = ++this.nextId;
    this.pending.set(id, now);
    while (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value!);
    return id;
  }
  acknowledge(id: number, now: number): boolean {
    const sent = this.pending.get(id);
    if (sent === undefined || now < sent || now - sent > 600) return false;
    this.pending.delete(id);
    this.consecutive = now - this.lastAck <= 600 ? this.consecutive + 1 : 1;
    this.lastAck = now;
    // Acknowledgement is delivery evidence, not a switch back from a relay path.
    // ADR035 has no relay, so there is no additional recovery quarantine.
    if (this.consecutive >= 2) this.unhealthySince = undefined;
    return true;
  }
  direct(now: number): boolean {
    if (now - this.lastAck > 600) this.consecutive = 0;
    const healthy = this.consecutive >= 2;
    if (healthy) this.unhealthySince = undefined;
    else this.unhealthySince ??= now;
    return healthy;
  }
  /** An open RTC channel survives brief impairment; retry only sustained failure. */
  shouldRestart(now: number): boolean {
    return !this.direct(now) && this.unhealthySince !== undefined && now - this.unhealthySince >= 8000;
  }
  fail(now: number): void { this.consecutive = 0; this.lastAck = -Infinity; this.unhealthySince ??= now; this.pending.clear(); }
}
