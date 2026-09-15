import { applyTick, cloneState, replayHash, isManagementKind, type LogEntry, type ReplayState } from '../shared/action-log.js';
import type { GameEvent } from '../shared/protocol.js';

export const SNAPSHOT_EVERY_TICKS = 4;
export const SNAPSHOT_COUNT = 12;
/** Entries stamped further ahead than this are refused; a sender's clock cannot pin a receiver, nor park an unprunable entry. */
export const MAX_FUTURE_TICKS = 14;
/** Ticks one `advanceTo` call will simulate; a bogus target catches up over several calls instead of busy-looping. */
export const MAX_ADVANCE_TICKS = 300;
/** While the clock is live a sample this far from the estimate is bogus, not drift. */
export const MAX_CLOCK_STEP_TICKS = 200;
export const TICK_MS = 50;

interface StreamLog { entries: Map<number, LogEntry>; contiguous: number; through: number }
export type InsertResult = 'new' | 'duplicate' | 'invalid' | 'clamped';
export type AdvanceResult = { status: 'ok'; rewound: number } | { status: 'baseline'; tick: number };

/**
 * The fold made incremental: every full view holds the same logs and the same snapshot ring, so simulating to a tick
 * gives the same state everywhere; a late entry rewinds once to the newest snapshot before it and replays.
 */
export class Simulation {
  private readonly logs = new Map<string, StreamLog>();
  private readonly snapshots: { tick: number; state: ReplayState }[] = [];
  private dirty = Infinity;
  /** Content key of every event emitted inside the window, to the tick it went out at; a rewind that moves an event must not repeat it. */
  private readonly emitted = new Map<string, number>();
  /** A view keeps a deeper ring than the authority so it still holds the tick whose hash the authority publishes after the packet's flight. */
  constructor(public state: ReplayState, public readonly creatorId: string, private readonly snapshotCount = SNAPSHOT_COUNT) { this.snapshots.push({ tick: state.game.tick, state: cloneState(state) }); }
  get tick(): number { return this.state.game.tick; }
  private log(id: string): StreamLog { let log = this.logs.get(id); if (!log) { log = { entries: new Map(), contiguous: 0, through: -1 }; this.logs.set(id, log); } return log; }
  /** Highest seq known contiguously for a stream, and the tick its entries are complete through. */
  stream(id: string): { contiguous: number; through: number } { const log = this.log(id); return { contiguous: log.contiguous, through: log.through }; }
  /** The first missing seq of a stream that has buffered entries beyond a gap, for a repair request. */
  gaps(): [string, number][] { return [...this.logs].filter(([, log]) => [...log.entries.keys()].some(seq => seq > log.contiguous + 1)).map(([id, log]) => [id, log.contiguous + 1]); }
  /** Highest contiguous seq whose entry is already folded into the current state; what a baseline reports. */
  folded(id: string): number {
    const log = this.logs.get(id); if (!log) return 0;
    for (let seq = log.contiguous; seq >= 1; seq--) { const entry = log.entries.get(seq); if (!entry || entry[1] <= this.tick) return seq; }
    return 0;
  }
  /** The replay hash of the ring snapshot at exactly `tick`, if one is kept; the diagnostic the host's hash is compared to. */
  hashAt(tick: number): string | undefined { const snapshot = this.snapshots.find(s => s.tick === tick); return snapshot && replayHash(snapshot.state); }
  /** Entries a stream has retained, in seq order; the sender side of repair. */
  retained(id: string): LogEntry[] { return [...(this.logs.get(id)?.entries.values() ?? [])].sort((a, b) => a[0] - b[0]); }
  /**
   * Inserts one entry. Management kinds are accepted only from the creator. An entry landing at or before the oldest
   * snapshot is clamped forward when `clamp` is set (the authority never loses input) and otherwise refused so the
   * caller can fetch a baseline; an entry stamped beyond the future bound is always refused. Anything accepted rewinds
   * no further than that snapshot, whose every later entry is still retained. A clamped tick is written back into
   * `entry` so a caller relaying the same array afterwards sends the tick that was actually folded.
   */
  insert(id: string, entry: LogEntry, clamp = false): InsertResult {
    if (isManagementKind(entry[2]) && id !== this.creatorId) return 'invalid';
    const log = this.log(id);
    if (entry[0] <= log.contiguous || log.entries.has(entry[0])) return 'duplicate';
    if (entry[1] > this.tick + MAX_FUTURE_TICKS) return 'invalid';
    const floor = this.snapshots[0]!.tick + 1;
    let tick = entry[1], result: InsertResult = 'new';
    if (tick < floor) { if (!clamp) return 'invalid'; tick = floor; entry[1] = tick; result = 'clamped'; }
    log.entries.set(entry[0], [entry[0], tick, ...entry.slice(2)] as LogEntry);
    this.extend(log);
    return result;
  }
  /**
   * Walks the contiguous prefix over every seq that just became reachable, raising each entry to the tick of the
   * highest seq below it. Every lower seq is present by then, so the stored tick is a function of the entry set and
   * not of the order the entries arrived in.
   */
  private extend(log: StreamLog): void {
    while (log.entries.has(log.contiguous + 1)) {
      log.contiguous += 1;
      const entry = log.entries.get(log.contiguous)!;
      if (entry[1] < log.through) entry[1] = log.through;
      if (entry[1] <= this.tick) this.dirty = Math.min(this.dirty, entry[1]);
      log.through = entry[1];
    }
  }
  /**
   * Rewinds if an accepted entry landed at or before the current tick, then simulates up to `target`, emitting each
   * event once by content key. Returns `baseline` when the rewind would need a tick older than the ring.
   */
  advanceTo(target: number, emit: (event: GameEvent, tick: number) => void): AdvanceResult {
    let rewound = 0;
    if (this.dirty <= this.tick) {
      const snapshot = [...this.snapshots].reverse().find(s => s.tick < this.dirty);
      if (!snapshot) { const tick = this.dirty; this.dirty = Infinity; return { status: 'baseline', tick }; }
      rewound = this.tick - snapshot.tick;
      this.state = cloneState(snapshot.state);
      this.snapshots.splice(this.snapshots.indexOf(snapshot) + 1);
    }
    this.dirty = Infinity;
    const limit = Math.min(target, this.tick + MAX_ADVANCE_TICKS);
    while (this.tick < limit) this.simulateTick(emit);
    return { status: 'ok', rewound };
  }
  private simulateTick(emit: (event: GameEvent, tick: number) => void): void {
    const tick = this.tick + 1, entries = new Map<string, LogEntry[]>();
    for (const [id, log] of this.logs) {
      const list: LogEntry[] = [];
      for (const [seq, entry] of log.entries) if (seq <= log.contiguous && entry[1] === tick) list.push(entry);
      if (list.length) entries.set(id, list.sort((a, b) => a[0] - b[0]));
    }
    const events = applyTick(this.state, tick, this.creatorId, entries);
    const scope = `${this.state.game.matchId}:${this.state.game.round}`;
    for (const event of events) { const key = `${scope}:${eventKey(event)}`; if (!this.emitted.has(key)) { this.emitted.set(key, tick); emit(event, tick); } }
    if (tick % SNAPSHOT_EVERY_TICKS === 0) { this.snapshots.push({ tick, state: cloneState(this.state) }); while (this.snapshots.length > this.snapshotCount) this.snapshots.shift(); }
    // The oldest snapshot is as far back as a rewind ever goes, and everything at or before it is already baked into
    // it; keeping entries exactly that long is what stops a rewind replaying a tick whose input was thrown away.
    const horizon = this.snapshots[0]!.tick;
    for (const log of this.logs.values()) for (const [seq, entry] of log.entries) if (seq <= log.contiguous && entry[1] <= horizon && seq < log.contiguous) log.entries.delete(seq);
    for (const [key, at] of this.emitted) if (at <= horizon) this.emitted.delete(key);
  }
  /**
   * Installs a baseline: the state at its tick plus, per stream, the highest seq folded into it. Anything at or before
   * that tick is already in the state and can never be replayed, so it is dropped rather than counted as pending;
   * `contiguous` follows what was dropped so it never moves backwards, and a stream the baseline does not mention is
   * cleared outright. Buffered entries stamped later stay and apply as the clock reaches them.
   */
  install(state: ReplayState, folded: ReadonlyMap<string, number>): void {
    this.state = state; this.snapshots.splice(0); this.snapshots.push({ tick: state.game.tick, state: cloneState(state) }); this.dirty = Infinity; this.emitted.clear();
    for (const id of new Set([...this.logs.keys(), ...folded.keys()])) {
      const log = this.log(id), seq = folded.get(id);
      if (seq === undefined) { log.entries.clear(); log.contiguous = 0; log.through = -1; continue; }
      let highest = seq;
      for (const [s, entry] of log.entries) if (s <= seq || entry[1] <= state.game.tick) { log.entries.delete(s); if (s > highest) highest = s; }
      log.contiguous = highest; log.through = state.game.tick;
      this.extend(log);
    }
  }
}
/** Identity of an event within one round; a rewind that moves it to another tick must produce the same key. */
function eventKey(event: GameEvent): string {
  switch (event.type) {
    case 'pickupCollected': return `pickup:${event.pickupId}:${event.playerId}`;
    case 'bombPlaced': return `placed:${event.bombId}`;
    case 'explosion': return `explosion:${event.bombId}`;
    case 'playerEliminated': return `dead:${event.playerId}`;
    case 'roundEnded': case 'matchEnded': return event.type;
  }
}

/** Local tick estimate from the host's samples: set outright once, then slewed symmetrically, and stepped forward only when far behind. */
export class TickClock {
  private originTick?: number;
  private originAt = 0;
  private lastSampleAt = -Infinity;
  private best?: { rtt: number; tick: number; at: number };
  constructor(private readonly now: () => number) {}
  get live(): boolean { return this.originTick !== undefined && this.now() - this.lastSampleAt <= 1000; }
  /** `hostTick` is the host's fractional tick when it sent; `rtt` comes from the echoed send time. */
  observe(hostTick: number, rtt: number): void {
    const at = this.now();
    if (!Number.isFinite(hostTick) || hostTick < 0 || !Number.isFinite(rtt) || rtt < 0 || rtt > 2000) return;
    const silent = at - this.lastSampleAt > 1000;
    const candidate = hostTick + rtt / 2 / TICK_MS;
    // A stamp this far from a running estimate is a bogus or hostile clock, not drift; only silence re-locks outright.
    if (!silent && this.originTick !== undefined && Math.abs(candidate - this.tick()) > MAX_CLOCK_STEP_TICKS) return;
    this.lastSampleAt = at;
    if (!this.best || at - this.best.at > 2000 || rtt <= this.best.rtt) this.best = { rtt, tick: candidate, at };
    const target = this.best.tick + (at - this.best.at) / TICK_MS;
    if (this.originTick === undefined || silent) { this.originTick = target; this.originAt = at; return; }
    const current = this.tick();
    const error = target - current;
    // One tick per second either way, so a single high-rtt sample cannot bias the estimate forever. Real time adds
    // twenty ticks a second, so slewing down never takes the clock below where it stood at the previous sample.
    const slew = (at - this.originAt) / 1000;
    const step = error > 4 ? error : Math.max(-slew, Math.min(error, slew));
    this.originTick = current + step; this.originAt = at;
  }
  tick(): number { return this.originTick === undefined ? 0 : this.originTick + (this.now() - this.originAt) / TICK_MS; }
  reset(): void { this.originTick = undefined; this.best = undefined; this.lastSampleAt = -Infinity; }
}
