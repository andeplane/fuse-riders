import { isEntry, PRESS, uint32, type Entry } from "../engine/input-log.js";

export const ROLLBACK_TICKS = 40;
/** Entries stamped further ahead than this are rejected. Clocks converge by slewing, so a live peer may legitimately
 * stamp a few seconds ahead for a while; the bound only keeps an absurd tick from parking entries forever. */
export const FUTURE_TICKS = 400;
export const RETAINED_ENTRIES = 64,
  RETAINED_TICKS = 40,
  PACKET_ENTRIES = 6,
  BUFFERED_ENTRIES = 256;
/**
 * How far a declared `lastSeq` may run ahead of the contiguous prefix. A rider logs a few tens of entries a second at
 * most and a repair (nack, then a snapshot) takes seconds, so an honest stream is never thousands of entries ahead of
 * what a replica holds. A larger claim is a gap no nack could ever repair: the packet is refused rather than opening it,
 * and the stream is flagged `ahead` so the replica resyncs from a snapshot, which is the only thing that can catch it up
 * (a replica cut off from a busy rider for minutes on the same page does get there honestly).
 */
export const SEQ_AHEAD = BUFFERED_ENTRIES * 16;
export type ReceiveStatus = "accepted" | "invalid" | "unrepairable";
/**
 * Why a packet was refused. `window`: it fell outside what this replica can take right now (its owner's seq is out of
 * reach, too much is already waiting behind a gap, or a tick is beyond this replica's own clock), which an honest packet
 * can do and which says nothing about its sender. `violation`: no unmodified client sends it.
 */
export type Refusal = "window" | "violation";
export interface ReceiveResult {
  status: ReceiveStatus;
  added: Entry[];
  rollbackTo?: number;
  refusal?: Refusal;
}
const refused = (refusal: Refusal): ReceiveResult => ({
  status: "invalid",
  added: [],
  refusal,
});
const same = (a: Entry, b: Entry): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

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
  /** Presses that can no longer be replayed (the construction base and pruned entries): the floor a base at any later tick starts from. */
  private baseGesture = 0;
  /** The highest pruned seq: a base at a later tick starts there, since pruned entries are folded into every retained snapshot. */
  private prunedSeq = 0;
  /** The highest `through` declared while the stream had no gap: final whatever gap opens later. */
  private confirmedTick = 0;
  /**
   * The owner's completeness promises. A packet declaring `through = T` with `lastSeq = S` promises that every entry
   * after seq S is stamped after tick T. `promisedFloor` is the highest T whose S the contiguous prefix has reached, so
   * it binds every entry not yet held; `promised` keeps the rest by S until the prefix reaches them.
   */
  private promisedFloor: number;
  private readonly promised = new Map<number, number>();
  /** The owner's last packet declared a `lastSeq` out of reach (`SEQ_AHEAD`): only a snapshot can catch this stream up. Cleared by the next packet taken. */
  ahead = false;
  private rotation = 0;
  constructor(
    public generation: number,
    base: { seq: number; tick: number; gesture?: number } = { seq: 0, tick: 0 },
  ) {
    this.contiguous = base.seq;
    this.baseSeq = base.seq;
    this.lastSeq = base.seq;
    this.baseTick = base.tick;
    this.through = this.confirmedTick = this.promisedFloor = base.tick;
    this.gestureFloor = this.baseGesture = base.gesture ?? 0;
  }
  /** Own stream only: the next seq, always contiguous. */
  append(tick: number, body: readonly unknown[]): Entry {
    const entry = [this.lastSeq + 1, tick, ...body] as Entry;
    if (!isEntry(entry) || tick < this.latestTick())
      throw new Error("Invalid own entry");
    if (entry[2] === PRESS) {
      if (entry[3] <= this.gestureFloor) throw new Error("Reused gesture");
      this.gestureFloor = entry[3];
    }
    this.entries.set(entry[0], entry);
    this.lastSeq = this.contiguous = entry[0];
    return entry;
  }
  /** Contiguous entries stamped `tick`, in seq order. */
  entriesAt(tick: number): Entry[] {
    const list: Entry[] = [];
    for (const entry of this.entries.values())
      if (entry[1] === tick && entry[0] <= this.contiguous) list.push(entry);
    return list.sort((a, b) => a[0] - b[0]);
  }
  /** Tick of the newest contiguous entry, or the base tick: nothing before it can still change. */
  latestTick(): number {
    let tick = this.baseTick;
    for (const entry of this.entries.values())
      if (entry[0] <= this.contiguous && entry[1] > tick) tick = entry[1];
    return tick;
  }
  get gap(): boolean {
    return this.contiguous < this.lastSeq;
  }
  /** Completeness the simulation may rely on: the owner's `through`, capped before the first entry waiting behind a gap. */
  completeThrough(): number {
    let through = this.through;
    for (const entry of this.entries.values())
      if (entry[0] > this.contiguous && entry[1] - 1 < through)
        through = entry[1] - 1;
    return through;
  }
  /** What can never change: with a gap, only ticks up to the last contiguous entry, since a missing entry's tick is unknown. */
  confirmedThrough(): number {
    return this.gap
      ? Math.max(
          this.confirmedTick,
          Math.min(this.through, this.latestTick() - 1),
        )
      : this.through;
  }
  firstMissing(): number | undefined {
    return this.gap ? this.contiguous + 1 : undefined;
  }
  /** Highest press gesture id in the contiguous prefix; presses must keep increasing across it. */
  latestGesture(): number {
    let gesture = this.gestureFloor;
    for (const entry of this.entries.values())
      if (
        entry[0] <= this.contiguous &&
        entry[2] === PRESS &&
        entry[3] > gesture
      )
        gesture = entry[3];
    return gesture;
  }

  /** Validates every entry before touching the stream; a single bad entry rejects the whole packet. */
  receive(
    raw: readonly unknown[],
    lastSeq: number,
    through: number,
    localTick: number,
    currentTick: number,
  ): ReceiveResult {
    if (
      !uint32(lastSeq) ||
      !uint32(through) ||
      !Array.isArray(raw) ||
      raw.length > PACKET_ENTRIES
    )
      return refused("violation");
    if (lastSeq > this.contiguous + SEQ_AHEAD) {
      this.ahead = true;
      return refused("window");
    }
    const seen = new Map(this.entries),
      gestureFloor = this.latestGesture(),
      tail = this.latestTick();
    for (const candidate of raw) {
      if (!isEntry(candidate) || candidate[0] > Math.max(lastSeq, this.lastSeq))
        return refused("violation");
      if (candidate[1] > localTick + FUTURE_TICKS) return refused("window");
      const [seq, tick] = candidate;
      const existing = seen.get(seq);
      if (existing) {
        if (!same(existing, candidate)) return refused("violation");
        continue;
      }
      if (seq <= this.contiguous) continue; // Already applied and pruned; a repeat carries nothing new.
      if (tick <= this.baseTick && this.contiguous === this.baseSeq)
        return { status: "unrepairable", added: [] }; // Older than the snapshot this stream started from.
      if (tick < tail) return refused("violation");
      // A new entry at or before a tick its owner already declared complete: folding it in would rewrite ticks
      // every replica was told were final (the owner saw two seconds of play before committing to them).
      if (tick <= this.promisedBefore(seq)) return refused("violation");
      for (const [otherSeq, other] of seen)
        if (
          (otherSeq < seq && other[1] > tick) ||
          (otherSeq > seq && other[1] < tick)
        )
          return refused("violation");
      if (candidate[2] === PRESS) {
        if (candidate[3] <= gestureFloor) return refused("violation");
        for (const [otherSeq, other] of seen)
          if (
            other[2] === PRESS &&
            ((otherSeq < seq && other[3] >= candidate[3]) ||
              (otherSeq > seq && other[3] <= candidate[3]))
          )
            return refused("violation");
      }
      seen.set(seq, candidate);
    }
    let buffered = 0;
    for (const seq of seen.keys()) if (seq > this.contiguous) buffered++;
    if (buffered > BUFFERED_ENTRIES) return refused("window");
    for (const [seq, entry] of seen) this.entries.set(seq, entry);
    this.ahead = false;
    this.lastSeq = Math.max(this.lastSeq, lastSeq);
    this.through = Math.max(this.through, through);
    const added: Entry[] = [];
    while (this.entries.has(this.contiguous + 1)) {
      this.contiguous++;
      added.push(this.entries.get(this.contiguous)!);
    }
    this.promise(lastSeq, through);
    if (!this.gap)
      this.confirmedTick = Math.max(this.confirmedTick, this.through);
    if (!added.length) return { status: "accepted", added };
    const earliest = Math.min(...added.map((entry) => entry[1]));
    if (earliest <= this.baseTick || earliest <= currentTick - ROLLBACK_TICKS)
      return { status: "unrepairable", added };
    return {
      status: "accepted",
      added,
      ...(earliest <= currentTick ? { rollbackTo: earliest } : {}),
    };
  }

  /** The latest tick the owner has promised to stamp no entry after `seq - 1` at: a new entry `seq` must come after it. */
  private promisedBefore(seq: number): number {
    let tick = this.promisedFloor;
    for (const [lastSeq, through] of this.promised)
      if (lastSeq < seq && through > tick) tick = through;
    return tick;
  }
  private promise(lastSeq: number, through: number): void {
    if (lastSeq > this.contiguous && through > this.promisedFloor)
      this.promised.set(
        lastSeq,
        Math.max(this.promised.get(lastSeq) ?? 0, through),
      );
    else if (through > this.promisedFloor) this.promisedFloor = through;
    for (const [seq, tick] of this.promised)
      if (seq <= this.contiguous) {
        if (tick > this.promisedFloor) this.promisedFloor = tick;
        this.promised.delete(seq);
      }
  }

  /** Own entries still worth resending: the last 64 or the last two seconds, whichever is smaller. */
  retained(): Entry[] {
    return [...this.entries.values()]
      .filter((entry) => entry[1] > this.through - RETAINED_TICKS)
      .sort((a, b) => a[0] - b[0])
      .slice(-RETAINED_ENTRIES);
  }
  /** Newest entries plus a rotating share of the retained window, so every retained entry recurs without acknowledgements. */
  packetEntries(): Entry[] {
    const retained = this.retained();
    if (retained.length <= PACKET_ENTRIES) return retained;
    const newest = retained.slice(-2),
      older = retained.slice(0, -2),
      chosen: Entry[] = [];
    for (let index = 0; index < PACKET_ENTRIES - newest.length; index++)
      chosen.push(older[(this.rotation + index) % older.length]!);
    this.rotation =
      (this.rotation + PACKET_ENTRIES - newest.length) % older.length;
    return [...chosen, ...newest].sort((a, b) => a[0] - b[0]);
  }
  /** Reply to a nack: retained entries from the first missing seq. */
  repairEntries(firstMissingSeq: number): Entry[] {
    const retained = this.retained();
    if (!retained.length || retained[0]![0] > firstMissingSeq) return []; // Beyond the window: only a snapshot helps.
    return retained
      .filter((entry) => entry[0] >= firstMissingSeq)
      .slice(0, PACKET_ENTRIES);
  }
  /** Where a joiner's copy of this stream starts when it installs a snapshot taken at `tick`. */
  baseAt(tick: number): { seq: number; tick: number; gesture: number } {
    // Every held entry stamped at or before `tick` is folded into the state served at `tick`, including entries waiting behind a
    // gap: the world at `tick` was simulated without the missing entry, and the joiner must not wait for it either (the serving
    // peer only serves past a gap once it is stalled on it, so a gap that a nack can still repair is served from before it).
    // Only presses at or before `tick` count: a press appended for a later tick travels in the replayed entries and must not be refused as reused.
    let seq = Math.max(this.baseSeq, this.prunedSeq),
      gesture = this.baseGesture;
    for (const entry of this.entries.values()) {
      if (entry[1] > tick) continue;
      seq = Math.max(seq, entry[0]);
      if (entry[2] === PRESS && entry[3] > gesture) gesture = entry[3];
    }
    return { seq, tick, gesture };
  }
  /** Every held entry after `seq` and after `tick`, in order: what a joiner replays on top of a snapshot taken at `tick`. */
  entriesAfter(seq: number, tick = -1): Entry[] {
    return [...this.entries.values()]
      .filter((entry) => entry[0] > seq && entry[1] > tick)
      .sort((a, b) => a[0] - b[0]);
  }
  /** Entries at or before `tick` can never be re-simulated again. */
  prune(tick: number): void {
    for (const [seq, entry] of this.entries)
      if (entry[1] <= tick && seq <= this.contiguous) {
        if (entry[2] === PRESS && entry[3] > this.baseGesture)
          this.baseGesture = entry[3];
        if (entry[2] === PRESS && entry[3] > this.gestureFloor)
          this.gestureFloor = entry[3];
        if (seq > this.prunedSeq) this.prunedSeq = seq;
        this.entries.delete(seq);
      }
  }
}
