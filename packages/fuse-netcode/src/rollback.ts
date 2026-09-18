import type {
  LogEntry,
  RollbackGame,
  RoomClock,
  StreamEntries,
  Ticker,
} from "./game.js";
import { disconnects, successionOrder } from "./management.js";
import {
  ROLLBACK_TICKS,
  StreamLog,
  type ReceiveResult,
  type StreamBase,
} from "./stream.js";

export const SNAPSHOT_INTERVAL = 4,
  SNAPSHOTS_RETAINED = 12,
  STALL_TICKS = ROLLBACK_TICKS;
export interface WorldEvent<Event = unknown> {
  /** The game's clock after the log tick that produced the event (`clock(room)`, as the frames carry it). */
  tick: number;
  round: number;
  matchId: string;
  event: Event;
}
export interface AdvanceResult<Event = unknown> {
  events: WorldEvent<Event>[];
  waitingFor?: string;
}
export interface WorldReceive<
  Entry extends LogEntry = LogEntry,
  Event = unknown,
> extends ReceiveResult<Entry> {
  events: WorldEvent<Event>[];
  rollbackTicks: number;
}
export type Frame<View extends { tick: number } = { tick: number }> = View & {
  matchId: string;
  /** The log tick this frame was simulated at. `tick` is the game's own clock, which a log tick can advance by more than one. */
  logTick: number;
};

/**
 * The speculative world: every stream folded up to the current tick, re-simulated from a retained snapshot when a
 * late entry changes history. Events are emitted once per (matchId, round, tick, index) across rollbacks.
 */
export class World<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings = unknown,
> {
  readonly streams = new Map<string, StreamLog<Entry>>();
  /** Streams a newer generation replaced: their entries still apply to folds of their generation when a rollback replays those ticks. */
  private retired = new Map<string, StreamLog<Entry>[]>();
  private snapshots = new Map<number, Room>();
  /** The game's clock after each log tick still replayable, so a log tick can be told in game time (`confirmedGameTick`). */
  private gameTicks = new Map<number, number>();
  private frames: Frame<View>[] = [];
  private emitted = new Set<string>();
  private readonly ticker: Ticker<Room, Entry, Event>;
  /**
   * The state being simulated. Settled, it is `state`. After a rollback whose re-run the budget window could not
   * finish, it is the re-run, short of `state.tick`, and `state` stays the newest state the world reached until the
   * re-run catches up and replaces it (`replay`): outside `World` nothing ever sees history go backwards.
   */
  private work: Room;
  /** The newest two frames of the re-run, shown once it reaches `state.tick`. */
  private replayFrames: Frame<View>[] = [];
  /** Events the re-run produced, delivered with its frames once it reaches `state.tick`. */
  private replayEvents: {
    key: string;
    logTick: number;
    event: WorldEvent<Event>;
  }[] = [];
  /** Steps the current budget window allows, and has spent (`refill`). */
  private budget = Infinity;
  private spent = 0;
  rollbacks = 0;
  rollbackTicks = 0;
  /** Simulation steps run since this world was created: a log tick runs one, or several in a fast phase. */
  steps = 0;
  constructor(
    readonly game: RollbackGame<Room, Entry, View, Event, Settings>,
    public state: Room,
    readonly creatorId: string,
    readonly selfId: string,
  ) {
    this.ticker = game.createTicker();
    this.work = state;
    this.snapshots.set(state.tick, structuredClone(state));
    this.gameTicks.set(state.tick, game.clock(state));
    this.frames = [this.frame(state)];
  }
  /** The log tick the world has folded through (`Room.tick`), not the game's clock. */
  get tick(): number {
    return this.state.tick;
  }
  /**
   * No rollback re-run is owed. While one is, `state`, `tick` and `view()` stay on the newest state the world reached
   * (history as it stood before the late entry) and `advance` finishes the re-run before any new tick.
   */
  get settled(): boolean {
    return this.work === this.state;
  }
  /**
   * Open a new budget window of `steps` simulation steps, shared by `advance` and rollbacks until the next refill.
   * Each log tick runs whole: one is started only if its step count (`RollbackGame.steps`, read off the state as its
   * fold reads it) still fits, except the first of a window, so a window never runs more than `max(steps, maxSteps)`.
   * A world never refilled has no budget, and every call runs to its target as before.
   */
  refill(steps: number): void {
    this.budget = steps;
    this.spent = 0;
  }
  /** Newest first: the two most recent simulated ticks, for fractional presentation. */
  view(): readonly Frame<View>[] {
    return this.frames;
  }
  stream(id: string, generation: number, base?: StreamBase): StreamLog<Entry> {
    const existing = this.streams.get(id);
    if (existing && existing.generation === generation) return existing;
    if (existing)
      this.retired.set(id, [
        ...(this.retired.get(id) ?? []).filter(
          (old) => old.generation !== generation,
        ),
        existing,
      ]);
    const stream = new StreamLog(
      this.game,
      generation,
      base ?? { seq: 0, tick: 0 },
    );
    this.streams.set(id, stream);
    return stream;
  }
  private frame(state: Room): Frame<View> {
    return {
      ...this.game.view(state),
      matchId: this.game.scope(state).matchId,
      logTick: state.tick,
    };
  }
  /** Each member's entries at `tick` from its current stream and from any retired generation still replayable; the reducer picks by fold generation. */
  private entriesAt(tick: number): Map<string, StreamEntries<Entry>> {
    const streams = new Map<string, StreamEntries<Entry>>();
    for (const [id, current] of this.streams) {
      const retired = (this.retired.get(id) ?? []).map((old) => ({
        generation: old.generation,
        entries: old.entriesAt(tick),
      }));
      streams.set(id, {
        generation: current.generation,
        entries: current.entriesAt(tick),
        ...(retired.length ? { retired } : {}),
      });
    }
    return streams;
  }
  /** Retired streams, oldest generation first, that a snapshot must carry so a joiner can replay the ticks before their replacement. */
  retiredStreams(): { id: string; stream: StreamLog<Entry> }[] {
    return [...this.retired].flatMap(([id, olds]) =>
      olds.map((stream) => ({ id, stream })),
    );
  }
  /** Entries in the applicable log that disconnect `id` after the current tick: the stall rule may not wait past them. */
  private pendingDisconnect(id: string): number | undefined {
    let earliest: number | undefined;
    for (const manager of successionOrder(
      this.game.members(this.state),
      this.creatorId,
    )) {
      const stream = this.streams.get(manager);
      if (!stream) continue;
      for (const entry of stream.entries.values()) {
        if (entry[0] > stream.contiguous || entry[1] <= this.tick) continue;
        if (disconnects(entry) === id)
          earliest = Math.min(earliest ?? Infinity, entry[1]);
      }
    }
    return earliest;
  }
  /** Simulation may run 40 ticks past a connected player's completeness; further is a stall on that player. */
  stallBound(): { tick: number; waitingFor?: string } {
    let bound = Infinity,
      waitingFor: string | undefined;
    // Only seated humans steer: nothing waits on a bot's or a watcher's stream.
    for (const player of this.game.members(this.state)) {
      if (
        !player.connected ||
        player.id === this.selfId ||
        player.bot ||
        player.watcher
      )
        continue;
      const stream = this.streams.get(player.id);
      let through = stream ? stream.completeThrough() : 0;
      const disconnect = this.pendingDisconnect(player.id);
      if (disconnect !== undefined) through = Math.max(through, disconnect);
      if (through + STALL_TICKS < bound) {
        bound = through + STALL_TICKS;
        waitingFor = player.name;
      }
    }
    return bound === Infinity
      ? { tick: Infinity }
      : { tick: bound, waitingFor: waitingFor! };
  }
  /**
   * Simulate forward to `targetTick`, stopping at the stall bound, which every applied tick may move, and when the
   * budget window is spent. A rollback's owed re-run goes first and is not held by the stall bound: the world had
   * already reached those ticks once.
   */
  advance(targetTick: number): AdvanceResult<Event> {
    const events: WorldEvent<Event>[] = [];
    let waitingFor: string | undefined,
      advanced = this.replay(events);
    while (this.settled && this.tick < targetTick) {
      const stall = this.stallBound();
      if (this.tick >= stall.tick) {
        waitingFor = stall.waitingFor;
        break;
      }
      if (!this.step(events, Math.min(targetTick, stall.tick))) break;
      advanced = true;
    }
    if (advanced) {
      this.showNewest();
      this.retain();
    }
    return { events, ...(waitingFor === undefined ? {} : { waitingFor }) };
  }
  /** Feed one packet's entries for a stream; a late applicable entry rolls the world back and re-simulates. */
  receive(
    id: string,
    entries: readonly unknown[],
    lastSeq: number,
    through: number,
    localTick: number,
  ): WorldReceive<Entry, Event> {
    const stream = this.streams.get(id);
    if (!stream)
      return {
        status: "invalid",
        added: [],
        refusal: "violation",
        events: [],
        rollbackTicks: 0,
      };
    const result = stream.receive(
      entries,
      lastSeq,
      through,
      localTick,
      // Late means at or before what has been simulated: an entry the owed re-run has not reached yet is folded when it does.
      this.work.tick,
    );
    if (result.status !== "accepted" || result.rollbackTo === undefined)
      return { ...result, events: [], rollbackTicks: 0 };
    const events: WorldEvent<Event>[] = [],
      rollbackTicks = this.rollback(result.rollbackTo, events);
    if (rollbackTicks < 0)
      return {
        status: "unrepairable",
        added: result.added,
        events: [],
        rollbackTicks: 0,
      };
    return { ...result, events, rollbackTicks };
  }
  /**
   * Restore the newest snapshot before `tick` and re-simulate to the tick the world had reached, as far as the budget
   * window allows; the rest is owed to the next `advance`. Returns the ticks to replay or -1.
   */
  private rollback(tick: number, events: WorldEvent<Event>[]): number {
    const current = this.tick,
      base = Math.max(
        ...[...this.snapshots.keys()].filter((at) => at < tick),
        -1,
      );
    if (base < 0) return -1;
    for (const at of [...this.snapshots.keys()])
      if (at > base) this.snapshots.delete(at);
    this.work = structuredClone(this.snapshots.get(base)!);
    this.replayFrames = [];
    // Held events of an interrupted re-run after the new base are re-simulated: the new timeline decides them afresh.
    this.replayEvents = this.replayEvents.filter((held) => {
      if (held.logTick <= base) return true;
      this.emitted.delete(held.key);
      return false;
    });
    this.replay(events);
    this.rollbacks++;
    this.rollbackTicks += current - base;
    return current - base;
  }
  /**
   * Run the owed re-run within the budget. Once it reaches `state.tick` it becomes `state`, and its frames and held
   * events are shown and delivered together.
   */
  private replay(events: WorldEvent<Event>[]): boolean {
    let ran = false;
    while (
      this.work.tick < this.state.tick &&
      this.step(events, this.state.tick)
    )
      ran = true;
    if (!this.settled && this.work.tick >= this.state.tick) {
      this.state = this.work;
      this.frames = this.replayFrames;
      this.showNewest();
      events.push(...this.replayEvents.map((held) => held.event));
      this.replayFrames = [];
      this.replayEvents = [];
    }
    return ran;
  }
  /** Make sure the newest frame is the settled state's, when a window stopped before a tick it expected to build one for. */
  private showNewest(): void {
    if (this.frames[0]?.logTick === this.state.tick) return;
    this.frames.unshift(this.frame(this.state));
    if (this.frames.length > 2) this.frames.length = 2;
  }
  /**
   * Fold one log tick if the budget window has room for its steps; false when it does not. Only the ticks that can end
   * up shown build a frame (a view is not free): the last two before `last`, and, settled, the last few a budget
   * window can hold; `showNewest` covers a window that stops earlier than expected.
   */
  private step(events: WorldEvent<Event>[], last: number): boolean {
    const state = this.work,
      replaying = !this.settled;
    if (this.spent > 0 && this.spent + this.game.steps(state) > this.budget)
      return false;
    const tick = state.tick + 1,
      { matchId, round } = this.game.scope(state),
      before = this.game.clock(state);
    const produced = this.ticker(state, this.creatorId, this.entriesAt(tick)),
      after = this.game.clock(state);
    this.spent += after - before;
    this.steps += after - before;
    // Keyed by log tick, which is what retention counts in; stamped with the game's clock, which is what every
    // consumer compares against the frames it is shown.
    produced.forEach((event, index) => {
      const key = `${matchId}:${round}:${tick}:${index}`;
      if (this.emitted.has(key)) return;
      this.emitted.add(key);
      const emitted = { tick: after, round, matchId, event };
      if (replaying)
        this.replayEvents.push({ key, logTick: tick, event: emitted });
      else events.push(emitted);
    });
    this.gameTicks.set(tick, after);
    if (tick % SNAPSHOT_INTERVAL === 0)
      this.snapshots.set(tick, structuredClone(state));
    const shown =
      last - tick <= 1 ||
      (!replaying && this.budget - this.spent < 2 * this.game.maxSteps);
    if (shown) {
      const frames = replaying ? this.replayFrames : this.frames;
      frames.unshift(this.frame(state));
      if (frames.length > 2) frames.length = 2;
    }
    return true;
  }
  /** Drop what can never be replayed again: old snapshots, applied entries before them and their event keys. */
  private retain(): void {
    const ticks = [...this.snapshots.keys()].sort((a, b) => a - b);
    while (ticks.length > SNAPSHOTS_RETAINED)
      this.snapshots.delete(ticks.shift()!);
    const oldest = ticks[0] ?? this.tick;
    for (const stream of this.streams.values()) stream.prune(oldest);
    // A retired stream is history once nothing it holds can be replayed again.
    for (const [id, olds] of this.retired) {
      const kept = olds.filter((old) => old.latestTick() > oldest);
      if (kept.length) this.retired.set(id, kept);
      else this.retired.delete(id);
    }
    for (const key of this.emitted)
      if (Number(key.split(":").at(-2)) <= oldest) this.emitted.delete(key);
    for (const tick of this.gameTicks.keys())
      if (tick < oldest) this.gameTicks.delete(tick);
  }
  get oldestSnapshotTick(): number {
    return Math.min(...this.snapshots.keys());
  }
  /** Ticks up to here are final on this replica: every connected member's stream is complete past them. */
  completeTick(): number {
    let complete = Infinity;
    for (const player of this.game.members(this.state)) {
      if (!player.connected || player.bot || player.watcher) continue;
      const stream = this.streams.get(player.id);
      complete = Math.min(complete, stream ? stream.confirmedThrough() : -1);
    }
    return complete;
  }
  /**
   * `completeTick()` in game time: the game's clock after the newest log tick every connected rider has confirmed, for
   * comparing with what the game stamps (`DecidedRound.tick`). A log tick can step the game several times, so the two
   * clocks drift apart for good once a bots-only endgame has run. -1 while nothing is confirmed.
   */
  confirmedGameTick(): number {
    // While a re-run is owed, `gameTicks` past it hold overturned history: nothing is newly confirmed until it is done.
    if (!this.settled) return this.settledConfirmed;
    const complete = this.completeTick();
    this.settledConfirmed =
      complete >= this.tick
        ? this.game.clock(this.state)
        : complete < 0
          ? -1
          : // Older than anything retained: the log tick itself is a lower bound, since every log tick steps at least once.
            (this.gameTicks.get(complete) ?? complete);
    return this.settledConfirmed;
  }
  /** `confirmedGameTick` as last read while settled. */
  private settledConfirmed = -1;
  /**
   * The state to serve a joiner: the newest retained snapshot no later than the complete tick, so nothing any member has
   * already logged up to it is still in flight; the current speculative state only when everything is complete.
   */
  servable(): { state: Room; tick: number } {
    const complete = this.completeTick();
    // While a re-run is owed, `state` is history a late entry has overturned: only the re-run and its snapshots are served.
    const current = this.work;
    // A replica stalled on a gap nobody can repair serves the state past it: that is how the room moves on without the entry.
    if (
      complete >= current.tick ||
      (this.settled && this.tick >= this.stallBound().tick)
    )
      return { state: current, tick: current.tick };
    const at = Math.max(
      ...[...this.snapshots.keys()].filter((tick) => tick <= complete),
      -1,
    );
    return at < 0
      ? { state: current, tick: current.tick }
      : { state: this.snapshots.get(at)!, tick: at };
  }
  /** Diagnostic hash of the retained state at `tick`, if one is kept there. */
  hashAt(tick: number): string | undefined {
    const state = this.snapshots.get(tick);
    return state ? this.game.hash(state) : undefined;
  }
  /** Replace the world wholesale from a validated snapshot; the caller re-creates streams from its metadata. */
  install(state: Room): void {
    this.state = this.work = state;
    this.snapshots = new Map([[state.tick, structuredClone(state)]]);
    this.gameTicks = new Map([[state.tick, this.game.clock(state)]]);
    this.frames = [this.frame(state)];
    this.replayFrames = [];
    this.replayEvents = [];
    this.emitted.clear();
    this.streams.clear();
    this.retired.clear();
  }
}
