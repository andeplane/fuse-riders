/**
 * Every device posts what its runtime saw — inputs, packets, repairs, baselines, rewinds, status changes — to the
 * dev server once a second, so a bad session can be read back instead of guessed at. Off in production (no port
 * in the address) unless `?telemetry=1`.
 */
export class Telemetry {
  private queue: Record<string, unknown>[] = [];
  private device: Record<string, unknown> = {};
  constructor(private readonly endpoint: string | undefined, private readonly now: () => number = () => performance.now()) {
    if (endpoint) { setInterval(() => this.flush(), 1000); addEventListener('pagehide', () => this.flush()); }
  }
  get enabled(): boolean { return this.endpoint !== undefined; }
  identify(fields: Record<string, unknown>): void { Object.assign(this.device, fields); }
  log(kind: string, data?: Record<string, unknown>): void {
    if (!this.endpoint) return;
    this.queue.push({ kind, at: Math.round(this.now()), wall: Date.now(), ...data });
    if (this.queue.length > 5000) this.queue.splice(0, this.queue.length - 5000);
  }
  flush(): void {
    if (!this.endpoint || !this.queue.length) return;
    const body = JSON.stringify({ device: this.device, events: this.queue.splice(0) });
    try {
      if (!navigator.sendBeacon?.(this.endpoint, new Blob([body], { type: 'application/json' }))) void fetch(this.endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
    } catch { /* telemetry never breaks the game */ }
  }
}
export function telemetryEndpoint(): string | undefined {
  return location.port !== '' || new URLSearchParams(location.search).has('telemetry') ? '/telemetry' : undefined;
}
