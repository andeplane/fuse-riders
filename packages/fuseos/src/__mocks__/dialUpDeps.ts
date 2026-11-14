import type { DialUpDeps } from "../sounds/dialup/dialUpDepsContext";

type Scheduled = { at: number; callback: () => void; cancelled: boolean };

/** Timers a test advances by hand with `advance(ms)`. */
export class ManualScheduler implements DialUpDeps {
  private now = 0;
  private readonly timers: Scheduled[] = [];

  schedule(callback: () => void, ms: number): () => void {
    const timer: Scheduled = { at: this.now + ms, callback, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /** Timers still waiting to fire. */
  get pending(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }

  /** Moves time forward, firing due timers in order (timers they schedule fire too when due). */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      this.now = due.at;
      due.callback();
    }
    this.now = target;
  }
}
