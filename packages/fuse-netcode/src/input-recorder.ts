import type { LogEntry } from "./game.js";
import type { StreamLog } from "./stream.js";

/**
 * What this device writes into the shared log, and when.
 *
 * Every entry this replica appends — a rider's controls, a management entry, its own presence — is stamped with a log
 * tick chosen here. The rule the whole runtime rests on is that the stamp never goes backwards and never lands on a
 * tick already folded: `next()` takes the clock's tick plus one, or the last stamp, whichever is later. A transition
 * that needs two entries (a side switch, a reclaimed seat) takes one `next()` and calls `at()` twice, so it lands whole
 * or not at all — `applyTick` runs a tick's entries in the order they were written, on every replica alike.
 *
 * `lastPacketTick` is the pacing half of the same job: the tick a packet last went out for. An append sets it to -1 so
 * the next loop pass sends immediately rather than waiting for the clock's tick to turn over, which is what keeps a
 * button press out by the next 10 ms pass instead of the next 100 ms tick.
 */
export class InputRecorder<Entry extends LogEntry> {
  /** The newest log tick this device has stamped an entry with. */
  private stamp = 0;
  /** The log tick a packet last went out for; -1 means one is owed. */
  lastPacketTick = -1;
  constructor(
    private readonly stream: () => StreamLog<Entry>,
    private readonly clockTick: () => number,
  ) {}
  /** The last stamp handed out: where a fresh world's first fold must reach for this device's own entries to apply. */
  get tick(): number {
    return this.stamp;
  }
  /** A world opened from nothing: this device has written no entry into it. */
  restart(): void {
    this.stamp = 0;
  }
  /** A snapshot installed at `tick`: the next entry is stamped after it, and a packet is owed. */
  resumeAfter(tick: number): void {
    this.stamp = Math.max(tick + 1, this.stamp);
    this.lastPacketTick = -1;
  }
  /** The tick to stamp the next entry (or the next group of entries) with. */
  next(): number {
    this.stamp = Math.max(Math.floor(this.clockTick()) + 1, this.stamp);
    return this.stamp;
  }
  /** One entry at the next tick. */
  append(body: unknown[]): number {
    return this.at(this.next(), body);
  }
  /**
   * One of this device's entries at a tick it already chose. A tick carries as many of them as the manager writes, and
   * the fold applies them in the order they were written (`applyTick`).
   */
  at(tick: number, body: unknown[]): number {
    this.stream().append(tick, body);
    this.lastPacketTick = -1;
    return tick;
  }
  /** A packet carrying everything through log tick `tick` has gone out. */
  sent(tick: number): void {
    this.lastPacketTick = tick;
  }
  /** Whether a packet is owed for log tick `tick`: an append since the last one, or a new tick. */
  owes(tick: number): boolean {
    return tick !== this.lastPacketTick;
  }
}
