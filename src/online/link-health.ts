/** Path-specific probe acknowledgements; socket readiness never proves delivery. */
export class LinkHealth {
  private nextId = 0;
  private pulseMode = false;
  private get freshness(): number { return this.pulseMode ? 2500 : 600; }
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
    this.recordAcknowledgement(now);
    return true;
  }
  /** Only the current, application-validated heartbeat supplies this delivery evidence. */
  acknowledgePulse(now: number): void { if (this.pulseMode) this.recordAcknowledgement(now); }
  setPulseMode(enabled: boolean, now: number): void {
    if (enabled === this.pulseMode) return;
    this.direct(now); // Expired evidence cannot be revived by changing its profile.
    this.pulseMode = enabled; this.pending.clear(); this.direct(now);
  }
  private recordAcknowledgement(now: number): void {
    this.consecutive = now - this.lastAck <= this.freshness ? this.consecutive + 1 : 1;
    this.lastAck = now;
    // Acknowledgement is delivery evidence, not a switch back from a relay path.
    // ADR035 has no relay, so there is no additional recovery quarantine.
    if (this.consecutive >= 2) this.unhealthySince = undefined;
  }
  direct(now: number): boolean {
    if (now - this.lastAck > this.freshness) this.consecutive = 0;
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


/** One-way participation state for a single alias on one RTC association. */
export class LinkPulseMode {
  private installed = false;
  private proof = false;
  private localPause = false;
  private remotePause = false;
  get activated(): boolean { return this.installed && !this.paused; }
  get active(): boolean { return this.activated && this.proof; }
  get paused(): boolean { return this.localPause || this.remotePause; }
  get locallyPaused(): boolean { return this.localPause; }
  /** The remote may already have replaced this alias while our checkpoint header is still health-gated. */
  needsAssociationProbe(remoteConfirmed:boolean): boolean { return this.paused || !remoteConfirmed; }
  activate(): boolean { if (this.paused) return false; this.installed = true; return true; }
  accept(): boolean { if (!this.activated) return false; this.proof = true; return true; }
  pauseLocal(): void { this.localPause = true; this.proof = false; }
  pauseRemote(): void { this.remotePause = true; this.proof = false; }
}
