import { applyTick, cloneState, ROLLBACK_WINDOW_TICKS, isManagementKind, type LogEntry, type ReplayState } from '../shared/action-log.js';
import type { GameEvent } from '../shared/protocol.js';

export const SNAPSHOT_EVERY_TICKS = 4;
export const SNAPSHOT_COUNT = 12;
/** Entries stamped further ahead than this are held until the local clock reaches them; a sender's clock cannot pin a receiver. */
export const MAX_FUTURE_TICKS = 14;
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
  private readonly emitted = new Set<string>();
  constructor(public state: ReplayState, public readonly creatorId: string) { this.snapshots.push({ tick: state.game.tick, state: cloneState(state) }); }
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
  /** Entries a stream has retained, in seq order; the sender side of repair. */
  retained(id: string): LogEntry[] { return [...(this.logs.get(id)?.entries.values() ?? [])].sort((a, b) => a[0] - b[0]); }
  /**
   * Inserts one entry. Management kinds are accepted only from the creator. An entry older than the oldest snapshot
   * is clamped forward when `clamp` is set (the authority never loses input) and otherwise refused so the caller can
   * fetch a baseline. Ticks must not decrease within a stream; a later seq with an earlier tick is clamped up.
   */
  insert(id: string, entry: LogEntry, clamp = false): InsertResult {
    if (isManagementKind(entry[2]) && id !== this.creatorId) return 'invalid';
    const log = this.log(id);
    if (entry[0] <= log.contiguous || log.entries.has(entry[0])) return 'duplicate';
    const floor = this.snapshots[0]!.tick + 1;
    let tick = entry[1], result: InsertResult = 'new';
    const previous = this.previousTick(log, entry[0]);
    if (tick < previous) { tick = previous; result = 'clamped'; }
    if (tick < floor) { if (!clamp) return 'invalid'; tick = floor; result = 'clamped'; }
    const stored: LogEntry = [entry[0], tick, ...entry.slice(2)] as LogEntry;
    log.entries.set(entry[0], stored);
    while (log.entries.has(log.contiguous + 1)) { log.contiguous += 1; const t = log.entries.get(log.contiguous)![1]; if (t <= this.tick) this.dirty = Math.min(this.dirty, t); log.through = t; }
    return result;
  }
  private previousTick(log: StreamLog, seq: number): number {
    let tick = 0;
    for (const [s, e] of log.entries) if (s < seq && e[1] > tick) tick = e[1];
    return tick;
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
    while (this.tick < target) this.simulateTick(emit);
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
    events.forEach((event, index) => { const key = `${tick}:${eventKey(event, index)}`; if (!this.emitted.has(key)) { this.emitted.add(key); emit(event, tick); } });
    if (tick % SNAPSHOT_EVERY_TICKS === 0) { this.snapshots.push({ tick, state: cloneState(this.state) }); while (this.snapshots.length > SNAPSHOT_COUNT) this.snapshots.shift(); }
    const horizon = tick - ROLLBACK_WINDOW_TICKS;
    for (const log of this.logs.values()) for (const [seq, entry] of log.entries) if (seq <= log.contiguous && entry[1] < horizon && seq < log.contiguous) log.entries.delete(seq);
    for (const key of this.emitted) if (Number(key.split(':')[0]) < horizon) this.emitted.delete(key);
  }
  /** Installs a baseline: the state at its tick plus, per stream, the highest seq folded into it. Later entries already buffered stay and apply as the clock reaches them. */
  install(state: ReplayState, folded: ReadonlyMap<string, number>): void {
    this.state = state; this.snapshots.splice(0); this.snapshots.push({ tick: state.game.tick, state: cloneState(state) }); this.dirty = Infinity; this.emitted.clear();
    for (const [id, seq] of folded) {
      const log = this.log(id);
      for (const s of [...log.entries.keys()]) if (s <= seq) log.entries.delete(s);
      log.contiguous = seq; log.through = state.game.tick;
      while (log.entries.has(log.contiguous + 1)) { log.contiguous += 1; const t = log.entries.get(log.contiguous)![1]; if (t <= this.tick) this.dirty = Math.min(this.dirty, t); log.through = t; }
    }
  }
}
function eventKey(event: GameEvent, index: number): string {
  switch (event.type) {
    case 'pickupCollected': return `pickup:${event.pickupId}:${event.playerId}`;
    case 'bombPlaced': return `placed:${event.bombId}`;
    case 'explosion': return `explosion:${event.bombId}`;
    case 'playerEliminated': return `dead:${event.playerId}`;
    case 'roundEnded': case 'matchEnded': return `${event.type}:${index}`;
  }
}

/** Local tick estimate from the host's samples: set outright once, then slewed, never stepped backwards while the host is live. */
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
    this.lastSampleAt = at;
    const candidate = hostTick + rtt / 2 / TICK_MS;
    if (!this.best || at - this.best.at > 2000 || rtt <= this.best.rtt) this.best = { rtt, tick: candidate, at };
    const target = this.best.tick + (at - this.best.at) / TICK_MS;
    if (this.originTick === undefined || silent) { this.originTick = target; this.originAt = at; return; }
    const current = this.tick();
    const error = target - current;
    const step = error > 4 ? error : Math.max(0, Math.min(error, (at - this.originAt) / 1000));
    this.originTick = current + step; this.originAt = at;
  }
  tick(): number { return this.originTick === undefined ? 0 : this.originTick + (this.now() - this.originAt) / TICK_MS; }
  reset(): void { this.originTick = undefined; this.best = undefined; this.lastSampleAt = -Infinity; }
}
