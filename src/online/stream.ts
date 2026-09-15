import { MAX_ENTRIES_PER_TICK, ROLLBACK_WINDOW_TICKS, type EntryBody, type LogEntry } from '../shared/action-log.js';
import { MAX_FUTURE_TICKS } from './rollback.js';

/** Floor on entries carried per packet: the newest ones plus a rotating share of the retained window. */
export const ENTRIES_PER_PACKET = 6;
/** How many of the newest entries ride in every packet regardless of the rotation. */
const NEWEST_PER_PACKET = 3;

/**
 * The sending side of one stream: numbers entries, retains the recent window, and answers "what goes in this
 * packet" so every retained entry is repeated without acknowledgements. The host keeps one per stream it relays.
 */
export class StreamSender {
  private readonly entries: LogEntry[] = [];
  /** Seq the rotation resumes at; a seq survives eviction and resizing, an index does not. */
  private cursorSeq = 0;
  lastSeq = 0;
  lastTick = 0;
  /**
   * Numbers a new own entry at the caller's tick, raised to keep the stream monotonic — but a stale `lastTick` may
   * only pull an entry `MAX_FUTURE_TICKS` ahead, so one absurd stamp cannot re-stamp the whole stream after it.
   */
  append(tick: number, body: EntryBody): LogEntry {
    const entry: LogEntry = [++this.lastSeq, Math.max(Math.min(this.lastTick, tick + MAX_FUTURE_TICKS), tick, 1), ...body] as LogEntry;
    this.lastTick = entry[1]; this.entries.push(entry); return entry;
  }
  /** Adopts an entry received from the stream's owner, for relay; ignores what is already retained. Relayed ticks are the owner's and are bounded by the receiver's `Simulation.insert`, which has a clock to bound them against. */
  adopt(entry: LogEntry): boolean {
    if (this.entries.some(e => e[0] === entry[0])) return false;
    this.entries.push(entry); this.entries.sort((a, b) => a[0] - b[0]);
    this.lastSeq = Math.max(this.lastSeq, entry[0]); this.lastTick = Math.max(this.lastTick, entry[1]); return true;
  }
  /** Drops entries the window no longer needs; by tick, since adopted entries arrive in seq order and not tick order. */
  retain(localTick: number): void {
    const horizon = localTick - ROLLBACK_WINDOW_TICKS;
    const kept = this.entries.filter(e => e[1] >= horizon);
    if (kept.length !== this.entries.length) { this.entries.length = 0; this.entries.push(...kept); }
  }
  get retained(): readonly LogEntry[] { return this.entries; }
  /**
   * The newest entries, then the rotating cursor over the older retained ones. The rotating share grows with the
   * window so the cursor laps it twice before the oldest entry is evicted, up to what one packet may carry.
   */
  next(): LogEntry[] {
    const count = this.entries.length;
    if (!count) return [];
    const newest = this.entries.slice(Math.max(0, count - NEWEST_PER_PACKET));
    const pool = this.entries.slice(0, count - newest.length);
    const budget = Math.min(MAX_ENTRIES_PER_TICK, Math.max(ENTRIES_PER_PACKET, newest.length + Math.ceil(pool.length / (ROLLBACK_WINDOW_TICKS / 2))));
    const out = [...newest];
    let start = pool.findIndex(e => e[0] >= this.cursorSeq); if (start < 0) start = 0;
    for (let i = 0; i < pool.length && out.length < budget; i++) { const entry = pool[(start + i) % pool.length]!; out.push(entry); this.cursorSeq = entry[0] + 1; }
    return out.sort((a, b) => a[0] - b[0]);
  }
  /** Entries from `firstMissingSeq` onward, for a repair request; empty when they are gone. */
  since(firstMissingSeq: number): LogEntry[] { return this.entries.filter(e => e[0] >= firstMissingSeq); }
}
