import { ROLLBACK_WINDOW_TICKS, type EntryBody, type LogEntry } from '../shared/action-log.js';

/** Entries carried per packet: the newest ones plus a rotating share of the retained window. */
export const ENTRIES_PER_PACKET = 6;

/**
 * The sending side of one stream: numbers entries, retains the recent window, and answers "what goes in this
 * packet" so every retained entry is repeated without acknowledgements. The host keeps one per stream it relays.
 */
export class StreamSender {
  private readonly entries: LogEntry[] = [];
  private cursor = 0;
  lastSeq = 0;
  lastTick = 0;
  /** Numbers a new own entry; the tick is the caller's, monotonic per stream. */
  append(tick: number, body: EntryBody): LogEntry {
    const entry: LogEntry = [++this.lastSeq, Math.max(tick, this.lastTick, 1), ...body] as LogEntry;
    this.lastTick = entry[1]; this.entries.push(entry); return entry;
  }
  /** Adopts an entry received from the stream's owner, for relay; ignores what is already retained. */
  adopt(entry: LogEntry): boolean {
    if (this.entries.some(e => e[0] === entry[0])) return false;
    this.entries.push(entry); this.entries.sort((a, b) => a[0] - b[0]);
    this.lastSeq = Math.max(this.lastSeq, entry[0]); this.lastTick = Math.max(this.lastTick, entry[1]); return true;
  }
  /** Drops entries the window no longer needs. */
  retain(localTick: number): void { const horizon = localTick - ROLLBACK_WINDOW_TICKS; let i = 0; while (i < this.entries.length && this.entries[i]![1] < horizon) i++; if (i) { this.entries.splice(0, i); this.cursor = 0; } }
  get retained(): readonly LogEntry[] { return this.entries; }
  /** Newest entries first, then the rotating cursor over older retained ones, so every entry repeats within a few packets. */
  next(): LogEntry[] {
    const count = this.entries.length;
    if (!count) return [];
    const newest = this.entries.slice(Math.max(0, count - Math.min(3, ENTRIES_PER_PACKET)));
    const out = [...newest];
    const older = count - newest.length;
    for (let i = 0; i < older && out.length < ENTRIES_PER_PACKET; i++) { out.push(this.entries[this.cursor % older]!); this.cursor++; }
    return out.sort((a, b) => a[0] - b[0]);
  }
  /** Entries from `firstMissingSeq` onward, for a repair request; empty when they are gone. */
  since(firstMissingSeq: number): LogEntry[] { return this.entries.filter(e => e[0] >= firstMissingSeq); }
}
