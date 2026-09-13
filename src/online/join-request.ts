/** Keep a deliberate join across authority checks and RTC setup until the roster confirms it. */
export class JoinRequest<T> {
  private pending?: T;
  private lastAttempt = -Infinity;
  request(value: T): void { this.pending = value; this.lastAttempt = -Infinity; }
  confirm(): void { this.pending = undefined; }
  retry(now: number, ready: boolean, send: (value: T) => void): void {
    if (!ready || this.pending === undefined || now - this.lastAttempt < 500) return;
    this.lastAttempt = now;
    send(this.pending);
  }
}
