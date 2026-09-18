import { BotController } from "../engine/bot-controller.js";
import {
  applyTick,
  hashRoomState,
  successionOrder,
  type RoomState,
  type StreamEntries,
} from "../engine/apply-tick.js";
import { stepsPerTick, toView } from "../engine/game.js";
import { LEAVE, PRESENCE } from "../engine/input-log.js";
import type { GameEvent, WorldView } from "../engine/view.js";
import { ROLLBACK_TICKS, StreamLog, type ReceiveResult } from "./stream.js";

export const SNAPSHOT_INTERVAL = 4,
  SNAPSHOTS_RETAINED = 12,
  STALL_TICKS = ROLLBACK_TICKS;
export interface WorldEvent {
  /** The game's clock after the log tick that produced the event (`GameState.tick`, as the frames carry it). */
  tick: number;
  round: number;
  matchId: string;
  event: GameEvent;
}
export interface AdvanceResult {
  events: WorldEvent[];
  waitingFor?: string;
}
export interface WorldReceive extends ReceiveResult {
  events: WorldEvent[];
  rollbackTicks: number;
}
export interface Frame extends WorldView {
  matchId: string;
  /** The log tick this frame was simulated at. `tick` is the game's own clock, which a log tick can advance by more than one. */
  logTick: number;
}

/**
 * The speculative world: every stream folded up to the current tick, re-simulated from a retained snapshot when a
 * late entry changes history. Events are emitted once per (matchId, round, tick, index) across rollbacks.
 */
export class World {
  readonly streams = new Map<string, StreamLog>();
  /** Streams a newer generation replaced: their entries still apply to folds of their generation when a rollback replays those ticks. */
  private retired = new Map<string, StreamLog[]>();
  private snapshots = new Map<number, RoomState>();
  /** The game's clock after each log tick still replayable, so a log tick can be told in game time (`confirmedGameTick`). */
  private gameTicks = new Map<number, number>();
  private frames: Frame[] = [];
  private emitted = new Set<string>();
  private readonly bots = new BotController();
  /**
   * A rollback's re-simulation still owed: the log tick the world had reached when it rolled back, while the re-run
   * is short of it (else -1). Frames stay on that tick until the re-run catches up; see `refill`.
   */
  private replayTo = -1;
  /** The newest two frames of the re-run, shown once it reaches `replayTo`. */
  private replayFrames: Frame[] = [];
  /** Steps the current budget window allows, and has spent (`refill`). */
  private budget = Infinity;
  private spent = 0;
  rollbacks = 0;
  rollbackTicks = 0;
  /** Simulation steps run since this world was created: a log tick runs one, or several in a fast phase. */
  steps = 0;
  constructor(
    public state: RoomState,
    readonly creatorId: string,
    readonly selfId: string,
  ) {
    this.snapshots.set(state.tick, structuredClone(state));
    this.gameTicks.set(state.tick, state.game.tick);
    this.frames = [this.frame(state)];
  }
  /** The log tick the world has folded through (`RoomState.tick`), not the game's clock. */
  get tick(): number {
    return this.state.tick;
  }
  /** The newest log tick this world has simulated: `tick`, or further while a rollback's re-run is still owed. */
  get frontier(): number {
    return Math.max(this.tick, this.replayTo);
  }
  /**
   * Open a new budget window of `steps` simulation steps, shared by `advance` and rollbacks until the next refill.
   * Each log tick runs whole: one is started only if its step count (read off the state, as `applyTick` reads it)
   * still fits, except the first of a window, so a window never runs more than `max(steps, MAX_STEPS_PER_TICK)`.
   * A world never refilled has no budget, and every call runs to its target as before.
   */
  refill(steps: number): void {
    this.budget = steps;
    this.spent = 0;
  }
  /** Newest first: the two most recent simulated ticks, for fractional presentation. */
  view(): readonly Frame[] {
    return this.frames;
  }
  stream(
    id: string,
    generation: number,
    base?: { seq: number; tick: number; gesture?: number },
  ): StreamLog {
    const existing = this.streams.get(id);
    if (existing && existing.generation === generation) return existing;
    if (existing)
      this.retired.set(id, [
        ...(this.retired.get(id) ?? []).filter(
          (old) => old.generation !== generation,
        ),
        existing,
      ]);
    const stream = new StreamLog(generation, base ?? { seq: 0, tick: 0 });
    this.streams.set(id, stream);
    return stream;
  }
  private frame(state: RoomState): Frame {
    return {
      ...toView(state.game),
      matchId: state.game.matchId,
      logTick: state.tick,
    };
  }
  /** Each member's entries at `tick` from its current stream and from any retired generation still replayable; the reducer picks by fold generation. */
  private entriesAt(tick: number): Map<string, StreamEntries> {
    const streams = new Map<string, StreamEntries>();
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
  retiredStreams(): { id: string; stream: StreamLog }[] {
    return [...this.retired].flatMap(([id, olds]) =>
      olds.map((stream) => ({ id, stream })),
    );
  }
  /** Entries in the applicable log that disconnect `id` after the current tick: the stall rule may not wait past them. */
  private pendingDisconnect(id: string): number | undefined {
    let earliest: number | undefined;
    for (const manager of successionOrder(this.state, this.creatorId)) {
      const stream = this.streams.get(manager);
      if (!stream) continue;
      for (const entry of stream.entries.values()) {
        if (entry[0] > stream.contiguous || entry[1] <= this.tick) continue;
        if (
          (entry[2] === PRESENCE && entry[3] === id && entry[4] === false) ||
          (entry[2] === LEAVE && entry[3] === id)
        )
          earliest = Math.min(earliest ?? Infinity, entry[1]);
      }
    }
    return earliest;
  }
  /** Simulation may run 40 ticks past a connected player's completeness; further is a stall on that player. */
  stallBound(): { tick: number; waitingFor?: string } {
    let bound = Infinity,
      waitingFor: string | undefined;
    for (const player of this.state.game.players.values()) {
      if (
        !player.connected ||
        player.id === this.selfId ||
        this.state.bots.has(player.id)
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
  advance(targetTick: number): AdvanceResult {
    const events: WorldEvent[] = [];
    let waitingFor: string | undefined,
      advanced = this.replay(events);
    while (this.replayTo < 0 && this.tick < targetTick) {
      const stall = this.stallBound();
      if (this.tick >= stall.tick) {
        waitingFor = stall.waitingFor;
        break;
      }
      if (!this.step(events)) break;
      advanced = true;
    }
    if (advanced) this.retain();
    return { events, ...(waitingFor === undefined ? {} : { waitingFor }) };
  }
  /** Feed one packet's entries for a stream; a late applicable entry rolls the world back and re-simulates. */
  receive(
    id: string,
    entries: readonly unknown[],
    lastSeq: number,
    through: number,
    localTick: number,
  ): WorldReceive {
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
      this.tick,
    );
    if (result.status !== "accepted" || result.rollbackTo === undefined)
      return { ...result, events: [], rollbackTicks: 0 };
    const events: WorldEvent[] = [],
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
   * Restore the newest snapshot before `tick` and re-simulate to the frontier, as far as the budget window allows; the
   * rest is owed to the next `advance`. Returns the ticks to replay or -1.
   */
  private rollback(tick: number, events: WorldEvent[]): number {
    const current = this.frontier,
      base = Math.max(
        ...[...this.snapshots.keys()].filter((at) => at < tick),
        -1,
      );
    if (base < 0) return -1;
    for (const at of [...this.snapshots.keys()])
      if (at > base) this.snapshots.delete(at);
    this.state = structuredClone(this.snapshots.get(base)!);
    this.replayTo = current;
    this.replayFrames = [];
    this.replay(events);
    this.rollbacks++;
    this.rollbackTicks += current - base;
    return current - base;
  }
  /** Run the owed re-run within the budget; once it reaches `replayTo`, its frames replace the ones shown. */
  private replay(events: WorldEvent[]): boolean {
    let ran = false;
    while (this.tick < this.replayTo && this.step(events)) ran = true;
    if (this.replayTo >= 0 && this.tick >= this.replayTo) {
      this.frames = this.replayFrames.length
        ? this.replayFrames
        : [this.frame(this.state)];
      this.replayFrames = [];
      this.replayTo = -1;
    }
    return ran;
  }
  /** Fold one log tick if the budget window has room for its steps; false when it does not. */
  private step(events: WorldEvent[]): boolean {
    const state = this.state;
    if (
      this.spent > 0 &&
      this.spent + stepsPerTick(state.game, state.bots) > this.budget
    )
      return false;
    const tick = state.tick + 1,
      matchId = state.game.matchId,
      round = state.game.round,
      before = state.game.tick;
    const produced = applyTick(
      state,
      this.creatorId,
      this.entriesAt(tick),
      this.bots,
    );
    this.spent += state.game.tick - before;
    this.steps += state.game.tick - before;
    // Keyed by log tick, which is what retention counts in; stamped with the game's clock, which is what every
    // consumer compares against the frames it is shown.
    produced.forEach((event, index) => {
      const key = `${matchId}:${round}:${tick}:${index}`;
      if (this.emitted.has(key)) return;
      this.emitted.add(key);
      events.push({ tick: state.game.tick, round, matchId, event });
    });
    this.gameTicks.set(tick, state.game.tick);
    if (tick % SNAPSHOT_INTERVAL === 0)
      this.snapshots.set(tick, structuredClone(state));
    const frames = this.replayTo >= 0 ? this.replayFrames : this.frames;
    frames.unshift(this.frame(state));
    if (frames.length > 2) frames.length = 2;
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
  /** Ticks up to here are final on this replica: every connected rider's stream is complete past them. */
  completeTick(): number {
    let complete = Infinity;
    for (const player of this.state.game.players.values()) {
      if (!player.connected || this.state.bots.has(player.id)) continue;
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
    const complete = this.completeTick();
    if (complete >= this.tick) return this.state.game.tick;
    if (complete < 0) return -1;
    // Older than anything retained: the log tick itself is a lower bound, since every log tick steps at least once.
    return this.gameTicks.get(complete) ?? complete;
  }
  /**
   * The state to serve a joiner: the newest retained snapshot no later than the complete tick, so nothing any rider has
   * already logged up to it is still in flight; the current speculative state only when everything is complete.
   */
  servable(): { state: RoomState; tick: number } {
    const complete = this.completeTick();
    // A replica stalled on a gap nobody can repair serves the state past it: that is how the room moves on without the entry.
    if (complete >= this.tick || this.tick >= this.stallBound().tick)
      return { state: this.state, tick: this.tick };
    const at = Math.max(
      ...[...this.snapshots.keys()].filter((tick) => tick <= complete),
      -1,
    );
    return at < 0
      ? { state: this.state, tick: this.tick }
      : { state: this.snapshots.get(at)!, tick: at };
  }
  /** Diagnostic hash of the retained state at `tick`, if one is kept there. */
  hashAt(tick: number): string | undefined {
    const state = this.snapshots.get(tick);
    return state ? hashRoomState(state) : undefined;
  }
  /** Replace the world wholesale from a validated snapshot; the caller re-creates streams from its metadata. */
  install(state: RoomState): void {
    this.state = state;
    this.snapshots = new Map([[state.tick, structuredClone(state)]]);
    this.gameTicks = new Map([[state.tick, state.game.tick]]);
    this.frames = [this.frame(state)];
    this.replayTo = -1;
    this.replayFrames = [];
    this.emitted.clear();
    this.streams.clear();
    this.retired.clear();
  }
}
