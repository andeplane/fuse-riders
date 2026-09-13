/** Path-specific probe acknowledgements; socket readiness never proves delivery. */
export class LinkHealth {
  private nextId = 0;
  private pending = new Map<number, number>();
  private lastAck = -Infinity;
  private consecutive = 0;
  private fallbackSince = 0;
  constructor(now: number) { this.fallbackSince = now; }
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
    return true;
  }
  direct(now: number): boolean {
    if (now - this.lastAck > 600) { if (this.consecutive) this.fallbackSince = now; this.consecutive = 0; }
    return this.consecutive >= 2 && now - this.fallbackSince >= 2000;
  }
  fail(now: number): void { this.consecutive = 0; this.lastAck = -Infinity; this.fallbackSince = now; this.pending.clear(); }
}
