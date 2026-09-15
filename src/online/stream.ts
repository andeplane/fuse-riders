import { isEntry, PRESS, uint32, type Entry } from '../shared/input-log.js';

export const ROLLBACK_TICKS = 40;
/** Entries stamped further ahead than this are rejected: a clock cannot be that far off a live peer. */
export const FUTURE_TICKS = 14;
export const RETAINED_ENTRIES = 64, RETAINED_TICKS = 40, PACKET_ENTRIES = 6, BUFFERED_ENTRIES = 256;
export type ReceiveStatus = 'accepted' | 'invalid' | 'unrepairable';
export interface ReceiveResult { status: ReceiveStatus; added: Entry[]; rollbackTo?: number }
const same = (a: Entry, b: Entry): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * One member's stream as this replica sees it: a contiguous prefix that the simulation may apply, a bounded set
 * of later entries waiting for a gap to be repaired, the owner's completeness tick and the highest issued seq.
 * The local member's own stream is the same structure fed by `append`, so the simulation reads every stream alike.
 */
export class StreamLog {
  readonly entries = new Map<number, Entry>();
  contiguous: number;
  lastSeq: number;
  through: number;
  readonly baseTick: number;
  private readonly baseSeq: number;
  private gestureFloor = 0;
  private rotation = 0;
  constructor(public generation: number, base: { seq: number; tick: number; gesture?: number } = { seq: 0, tick: 0 }) {
    this.contiguous = base.seq; this.baseSeq = base.seq; this.lastSeq = base.seq; this.baseTick = base.tick; this.through = base.tick; this.gestureFloor = base.gesture ?? 0;
  }
  /** Own stream only: the next seq, always contiguous. */
  append(tick: number, body: readonly unknown[]): Entry {
    const entry = [this.lastSeq + 1, tick, ...body] as Entry;
    if (!isEntry(entry) || tick < this.latestTick()) throw new Error('Invalid own entry');
    if (entry[2] === PRESS) { if (entry[3] <= this.gestureFloor) throw new Error('Reused gesture'); this.gestureFloor = entry[3]; }
    this.entries.set(entry[0], entry); this.lastSeq = this.contiguous = entry[0];
    return entry;
  }
  /** Contiguous entries stamped `tick`, in seq order. */
  entriesAt(tick: number): Entry[] {
    const list: Entry[] = [];
    for (const entry of this.entries.values()) if (entry[1] === tick && entry[0] <= this.contiguous) list.push(entry);
    return list.sort((a, b) => a[0] - b[0]);
  }
  /** Tick of the newest contiguous entry, or the base tick: nothing before it can still change. */
  latestTick(): number {
    let tick = this.baseTick;
    for (const entry of this.entries.values()) if (entry[0] <= this.contiguous && entry[1] > tick) tick = entry[1];
    return tick;
  }
  get gap(): boolean { return this.contiguous < this.lastSeq; }
  /** Completeness the simulation may rely on: the owner's `through`, capped before the first entry waiting behind a gap. */
  completeThrough(): number {
    let through = this.through;
    for (const entry of this.entries.values()) if (entry[0] > this.contiguous && entry[1] - 1 < through) through = entry[1] - 1;
    return through;
  }
  firstMissing(): number | undefined { return this.gap ? this.contiguous + 1 : undefined; }
  /** Highest press gesture id in the contiguous prefix; presses must keep increasing across it. */
  latestGesture(): number {
    let gesture = this.gestureFloor;
    for (const entry of this.entries.values()) if (entry[0] <= this.contiguous && entry[2] === PRESS && entry[3] > gesture) gesture = entry[3];
    return gesture;
  }

  /** Validates every entry before touching the stream; a single bad entry rejects the whole packet. */
  receive(raw: readonly unknown[], lastSeq: number, through: number, localTick: number, currentTick: number): ReceiveResult {
    if (!uint32(lastSeq) || !uint32(through) || !Array.isArray(raw) || raw.length > PACKET_ENTRIES) return { status: 'invalid', added: [] };
    const seen = new Map(this.entries), gestureFloor = this.latestGesture(), tail = this.latestTick();
    for (const candidate of raw) {
      if (!isEntry(candidate) || candidate[0] > Math.max(lastSeq, this.lastSeq) || candidate[1] > localTick + FUTURE_TICKS) return { status: 'invalid', added: [] };
      const [seq, tick] = candidate;
      const existing = seen.get(seq);
      if (existing) { if (!same(existing, candidate)) return { status: 'invalid', added: [] }; continue; }
      if (seq <= this.contiguous) continue; // Already applied and pruned; a repeat carries nothing new.
      if (tick <= this.baseTick && this.contiguous === this.baseSeq) return { status: 'unrepairable', added: [] }; // Older than the snapshot this stream started from.
      if (tick < tail) return { status: 'invalid', added: [] };
      for (const [otherSeq, other] of seen) if ((otherSeq < seq && other[1] > tick) || (otherSeq > seq && other[1] < tick)) return { status: 'invalid', added: [] };
      if (candidate[2] === PRESS) {
        if (candidate[3] <= gestureFloor) return { status: 'invalid', added: [] };
        for (const [otherSeq, other] of seen) if (other[2] === PRESS && ((otherSeq < seq && other[3] >= candidate[3]) || (otherSeq > seq && other[3] <= candidate[3]))) return { status: 'invalid', added: [] };
      }
      seen.set(seq, candidate);
    }
    let buffered = 0;
    for (const seq of seen.keys()) if (seq > this.contiguous) buffered++;
    if (buffered > BUFFERED_ENTRIES) return { status: 'invalid', added: [] };
    for (const [seq, entry] of seen) this.entries.set(seq, entry);
    this.lastSeq = Math.max(this.lastSeq, lastSeq); this.through = Math.max(this.through, through);
    const added: Entry[] = [];
    while (this.entries.has(this.contiguous + 1)) { this.contiguous++; added.push(this.entries.get(this.contiguous)!); }
    if (!added.length) return { status: 'accepted', added };
    const earliest = Math.min(...added.map(entry => entry[1]));
    if (earliest <= this.baseTick || earliest <= currentTick - ROLLBACK_TICKS) return { status: 'unrepairable', added };
    return { status: 'accepted', added, ...(earliest <= currentTick ? { rollbackTo: earliest } : {}) };
  }

  /** Own entries still worth resending: the last 64 or the last two seconds, whichever is smaller. */
  retained(): Entry[] {
    return [...this.entries.values()].filter(entry => entry[1] > this.through - RETAINED_TICKS).sort((a, b) => a[0] - b[0]).slice(-RETAINED_ENTRIES);
  }
  /** Newest entries plus a rotating share of the retained window, so every retained entry recurs without acknowledgements. */
  packetEntries(): Entry[] {
    const retained = this.retained();
    if (retained.length <= PACKET_ENTRIES) return retained;
    const newest = retained.slice(-2), older = retained.slice(0, -2), chosen: Entry[] = [];
    for (let index = 0; index < PACKET_ENTRIES - newest.length; index++) chosen.push(older[(this.rotation + index) % older.length]!);
    this.rotation = (this.rotation + PACKET_ENTRIES - newest.length) % older.length;
    return [...chosen, ...newest].sort((a, b) => a[0] - b[0]);
  }
  /** Reply to a nack: retained entries from the first missing seq. */
  repairEntries(firstMissingSeq: number): Entry[] {
    const retained = this.retained();
    if (!retained.length || retained[0]![0] > firstMissingSeq) return []; // Beyond the window: only a snapshot helps.
    return retained.filter(entry => entry[0] >= firstMissingSeq).slice(0, PACKET_ENTRIES);
  }
  /** Where a joiner's copy of this stream starts when it installs a snapshot taken at `tick`. */
  baseAt(tick: number): { seq: number; tick: number; gesture: number } {
    let seq = this.contiguous, gesture = this.gestureFloor;
    for (const entry of this.entries.values()) {
      if (entry[0] > this.contiguous) continue;
      if (entry[1] > tick) seq = Math.min(seq, entry[0] - 1);
      else if (entry[2] === PRESS && entry[3] > gesture) gesture = entry[3];
    }
    return { seq, tick, gesture };
  }
  /** Every held entry after `seq` and after `tick`, in order: what a joiner replays on top of a snapshot taken at `tick`. */
  entriesAfter(seq: number, tick = -1): Entry[] { return [...this.entries.values()].filter(entry => entry[0] > seq && entry[1] > tick).sort((a, b) => a[0] - b[0]); }
  /** Entries at or before `tick` can never be re-simulated again. */
  prune(tick: number): void {
    for (const [seq, entry] of this.entries) if (entry[1] <= tick && seq <= this.contiguous) {
      if (entry[2] === PRESS && entry[3] > this.gestureFloor) this.gestureFloor = entry[3];
      this.entries.delete(seq);
    }
  }
}
