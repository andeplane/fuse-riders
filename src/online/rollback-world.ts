import { toSnapshot } from '../shared/game.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import { canonical, replayHash, validAim } from '../shared/action-log.js';
import { DIRECT_RULES, stepDirect, uint32, type DirectState } from '../shared/direct-input.js';
import type { GameEvent } from '../shared/protocol.js';
import { FUTURE_RECORD_TICKS } from './direct-clock.js';
import { decodeGameState, encodeGameState } from './checkpoint.js';
import { packMessage, unpackMessage } from './action-replication.js';
import { decodeDirectPacket, DIRECT_VERSION, DirectStream, type DirectReceipt } from './direct-stream.js';

export const ROLLBACK_TICKS = 40;
export const ROLLBACK_BYTES = 32_000_000;
const SNAPSHOT_INTERVAL = 5;
const CHECKPOINT_BYTES = 2_000_000;
export type StreamPrefixes = [slot: number, sequence: number][];
export type Finality = [version: 1, segment: number, kind: 'final', tick: number, prefixes: StreamPrefixes, hash: string];
export interface CommittedEvent { id: string; tick: number; event: GameEvent }
export interface WorldResult {
  status: 'accepted' | 'stale' | 'waiting' | 'invalid' | 'overflow' | 'paused';
  events: CommittedEvent[];
  rollbackTicks: number;
  corrupt?: true;
  receipt?: Uint8Array;
  admittedTicks?: number[];
}
interface PresentationFrame { view: ViewSnapshot; bytes: number }
interface Candidate { views: Map<number, PresentationFrame>; state: DirectState; snapshots: Map<number, Uint8Array>; events: Map<number, GameEvent[]>; phaseChanges: Set<number> }
function presentationFrame(state: DirectState): PresentationFrame {
  const game = state.game, view = { ...toSnapshot(game), tick: game.tick, round: game.round };
  return { view, bytes: packMessage(view).byteLength };
}
const result = (status: WorldResult['status'], corrupt = false): WorldResult => ({ status, events: [], rollbackTicks: 0, ...(corrupt ? { corrupt: true as const } : {}) });

function packState(state: DirectState): Uint8Array {
  return packMessage([encodeGameState(state.game), [...state.held].map(([s, h]) => [s, h.at, h.flags, h.aim]), [...state.gestures].map(([s, g]) => [s, g.active, g.latest])]);
}
function readState(bytes: Uint8Array): DirectState | undefined {
  if (bytes.byteLength > CHECKPOINT_BYTES) return;
  try {
    const v = unpackMessage(bytes);
    if (!Array.isArray(v) || v.length !== 3 || typeof v[0] !== 'string' || !Array.isArray(v[1]) || v[1].length > 5 || !Array.isArray(v[2]) || v[2].length > 5) return;
    const game = decodeGameState(v[0]);
    if (!game || !uint32(game.tick)) return;
    const state: DirectState = { game, held: new Map(), gestures: new Map() };
    const slots = new Set([...game.players.values()].map(p => p.slot));
    for (const h of v[1]) {
      if (!Array.isArray(h) || h.length !== 4 || !uint32(h[0]) || !slots.has(h[0]) || state.held.has(h[0]) || !uint32(h[1]) || h[1] > game.tick || !uint32(h[2]) || h[2] > 7 || !validAim(h[3])) return;
      state.held.set(h[0], { at: h[1], flags: h[2], aim: h[3] });
    }
    for (const g of v[2]) {
      if (!Array.isArray(g) || g.length !== 3 || !g.every(uint32) || !slots.has(g[0]) || state.gestures.has(g[0]) || (g[1] !== 0 && g[1] !== g[2])) return;
      state.gestures.set(g[0], { active: g[1], latest: g[2] });
    }
    for (const player of game.players.values()) {
      const active = state.gestures.get(player.slot)?.active ?? 0;
      if (!!active !== !!((state.held.get(player.slot)?.flags ?? 0) & 4) || (player.bombChargeStartedTick !== undefined && !active)) return;
    }
    return state;
  } catch { return; }
}
function validPrefixes(raw: unknown, state: DirectState): raw is StreamPrefixes {
  if (!Array.isArray(raw) || raw.length !== state.game.players.size) return false;
  const slots = new Set([...state.game.players.values()].map(p => p.slot));
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !uint32(p[0]) || !uint32(p[1]) || !slots.delete(p[0])) return false;
  }
  return slots.size === 0;
}

export function packBootstrap(segment: number, state: DirectState, prefixes: StreamPrefixes): Uint8Array {
  if (!uint32(segment) || segment === 0 || !validPrefixes(prefixes, state)) throw new Error('Invalid bootstrap');
  const bytes = packMessage([DIRECT_VERSION, DIRECT_RULES, segment, packState(state), prefixes, replayHash(state)]);
  if (bytes.byteLength > CHECKPOINT_BYTES) throw new Error('Bootstrap too large');
  return bytes;
}

/** Fixed-roster segment: network arrival never advances its clock, and no host tick batches are needed. */
export class RollbackWorld {
  private candidate: Candidate;
  private streams = new Map<number, DirectStream>();
  private pendingFinality = new Map<number, Finality>();
  private finalTick: number;
  private finalHash: string;
  private finalPrefixes: StreamPrefixes;
  private constructor(readonly segment: number, state: DirectState, prefixes: StreamPrefixes, private readonly byteLimit: number, source?: RollbackWorld) {
    if (source) {
      this.finalTick = source.finalTick; this.finalHash = source.finalHash; this.finalPrefixes = source.finalPrefixes;
      this.candidate = source.candidate; this.streams = new Map(source.streams); this.pendingFinality = new Map(source.pendingFinality);
      return;
    }
    this.finalTick = state.game.tick; this.finalHash = replayHash(state); this.finalPrefixes = structuredClone(prefixes);
    this.candidate = { views: new Map([[state.game.tick, presentationFrame(state)]]), state, snapshots: new Map([[state.game.tick, packState(state)]]), events: new Map(), phaseChanges: new Set() };
    for (const [slot, sequence] of prefixes) this.streams.set(slot, new DirectStream({ sequence, tick: state.game.tick, gesture: state.gestures.get(slot)?.latest ?? 0 }));
  }
  static open(bytes: Uint8Array, expectedSegment: number, byteLimit = ROLLBACK_BYTES): RollbackWorld | undefined {
    if (bytes.byteLength > CHECKPOINT_BYTES || !Number.isSafeInteger(byteLimit) || byteLimit <= 0 || byteLimit > ROLLBACK_BYTES) return;
    try {
      const v = unpackMessage(bytes);
      if (!Array.isArray(v) || v.length !== 6 || v[0] !== DIRECT_VERSION || v[1] !== DIRECT_RULES || !uint32(v[2]) || v[2] === 0 || v[2] !== expectedSegment || !(v[3] instanceof Uint8Array)) return;
      const state = readState(v[3]);
      if (!state || !validPrefixes(v[4], state) || v[5] !== replayHash(state)) return;
      const world = new RollbackWorld(v[2], state, v[4], byteLimit);
      return world.retainedBytes <= byteLimit ? world : undefined;
    } catch { return; }
  }
  /** Read-only to consumers; the runtime must not mutate supplied simulation objects. */
  get state(): Readonly<DirectState> { return this.candidate.state; }
  /** Immutable exact frames; rendering never invokes physics or checkpoint replay. */
  presentationFrames(): readonly ViewSnapshot[] { return [...this.candidate.views.values()].map(frame => frame.view); }
  get presentationBytes(): number { return [...this.candidate.views.values()].reduce((sum, frame) => sum + frame.bytes, 0); }
  get finalizedTick(): number { return this.finalTick; }
  get finalizedHash(): string { return this.finalHash; }
  get finalizedPrefixes(): StreamPrefixes { return structuredClone(this.finalPrefixes); }
  streamProgress(): { slot: number; contiguous: number; watermark: [number, number]; cuts: [number, number][] }[] {
    return [...this.streams].map(([slot, stream]) => ({ slot, contiguous: stream.contiguous, watermark: [...stream.watermark], cuts: [...stream.cuts] }));
  }
  /** A fresh validated copy, suitable for a lifecycle barrier or finalized outcome presentation. */
  finalizedState(): DirectState { return this.stateAt(this.finalTick)!; }
  get retainedBytes(): number { return this.measure(this.candidate, this.streams); }
  get retainedRecords(): number { return [...this.streams.values()].reduce((sum, s) => sum + s.records.size, 0); }
  get pendingFinalizedTick(): number | undefined { return this.pendingFinality.size ? Math.max(...this.pendingFinality.keys()) : undefined; }

  get pendingEventTick(): number | undefined { return this.candidate.events.size ? Math.min(...this.candidate.events.keys()) : undefined; }

  get pendingConfirmationTick(): number | undefined {
    const ticks = [...this.candidate.events.keys(), ...this.candidate.phaseChanges];
    return ticks.length ? Math.min(...ticks) : undefined;
  }

  /** Validate all heartbeat progress and finality on a candidate, including already-pending certificates. */
  prepareProgress(cuts: readonly (readonly [number, number, number])[], finality: unknown, localTargetTick: number): { outcome: WorldResult; world?: RollbackWorld } {
    if (!Array.isArray(cuts) || cuts.length > 5 || !uint32(localTargetTick) || cuts.some(c => !Array.isArray(c) || c.length !== 3 || !c.every(uint32) || !this.streams.has(c[0])) || new Set(cuts.map(c => c[0])).size !== cuts.length) return { outcome: result('invalid') };
    const world = new RollbackWorld(this.segment, this.candidate.state, this.finalPrefixes, this.byteLimit, this);
    const outcome = result('accepted');
    for (const [slot, tick, sequence] of cuts) {
      const received = world.receive(slot, packMessage([DIRECT_VERSION, this.segment, slot, [], [tick, sequence]]), localTargetTick);
      if (received.status === 'invalid' || received.status === 'overflow') return { outcome: received };
      outcome.events.push(...received.events);
    }
    if (finality !== null) {
      const committed = world.finalize(finality);
      if (committed.status === 'invalid' || committed.status === 'overflow') return { outcome: committed };
      outcome.events.push(...committed.events);
    }
    return { outcome, world };
  }

  receive(ownerSlot: number, bytes: Uint8Array, localTargetTick: number): WorldResult {
    const packet = decodeDirectPacket(bytes);
    if (!packet || packet[2] !== ownerSlot || !this.streams.has(ownerSlot) || !uint32(localTargetTick)) return result('invalid');
    if (packet[1] !== this.segment) return result('stale');
    const received = this.streams.get(ownerSlot)!.receive(packet[3], packet[4], Math.min(localTargetTick, this.finalTick + ROLLBACK_TICKS) + FUTURE_RECORD_TICKS);
    if (received.status !== 'accepted') return result(received.status);
    const streams = new Map(this.streams); streams.set(ownerSlot, received.stream);
    const earliest = Math.min(...received.added.map(a => a[1]));
    let candidate = this.candidate;
    const rollbackTicks = earliest <= candidate.state.game.tick ? candidate.state.game.tick - earliest + 1 : 0;
    if (rollbackTicks) {
      const base = this.restoreBefore(earliest);
      if (!base) return result('invalid');
      candidate = this.simulate(base, streams, this.candidate.state.game.tick);
    }
    if (this.measure(candidate, streams) > this.byteLimit) return result('overflow');
    const previousCandidate = this.candidate, previousStreams = this.streams;
    this.streams = streams; this.candidate = candidate;
    const receipt: DirectReceipt = [DIRECT_VERSION, this.segment, ownerSlot, received.stream.contiguous];
    const committed = this.tryFinality();
    if (committed.status === 'invalid' || committed.status === 'overflow') { this.candidate = previousCandidate; this.streams = previousStreams; return committed; }
    return { ...committed, status: committed.status === 'waiting' ? 'accepted' : committed.status, receipt: packMessage(receipt), rollbackTicks, admittedTicks: received.added.map(action => action[1]) };
  }

  advance(targetTick: number): WorldResult {
    if (!uint32(targetTick) || targetTick < this.state.game.tick) return result('invalid');
    const stop = Math.min(targetTick, this.finalTick + ROLLBACK_TICKS, this.state.game.tick + 8);
    const candidate = this.simulate({ views: new Map(this.candidate.views), state: structuredClone(this.candidate.state), snapshots: new Map(this.candidate.snapshots), events: new Map(this.candidate.events), phaseChanges: new Set(this.candidate.phaseChanges) }, this.streams, stop);
    if (this.measure(candidate, this.streams) > this.byteLimit) return result('overflow');
    const previousCandidate = this.candidate;
    this.candidate = candidate;
    const committed = this.tryFinality();
    if (committed.status === 'invalid' || committed.status === 'overflow') { this.candidate = previousCandidate; return committed; }
    if (committed.status === 'waiting') committed.status = targetTick > this.finalTick + ROLLBACK_TICKS ? 'paused' : 'accepted';
    return committed;
  }

  /** Coordinator can offer this only after every stream has certified a complete prefix. */
  proposeFinality(tick: number): Finality | undefined {
    if (!uint32(tick) || tick < this.finalTick || tick > this.state.game.tick || [...this.streams.values()].some(s => !s.completeThrough(tick))) return;
    const state = this.stateAt(tick);
    if (!state) return;
    return [DIRECT_VERSION, this.segment, 'final', tick, [...this.streams].map(([slot, s]) => [slot, s.prefixAt(tick)]), replayHash(state)];
  }
  finalize(raw: unknown): WorldResult {
    if (!Array.isArray(raw) || raw.length !== 6 || raw[0] !== DIRECT_VERSION || raw[1] !== this.segment || raw[2] !== 'final' || !uint32(raw[3]) || raw[3] > this.finalTick + ROLLBACK_TICKS || !validPrefixes(raw[4], this.candidate.state) || typeof raw[5] !== 'string' || !/^[0-9a-f]{16}$/.test(raw[5])) return result('invalid');
    const message = structuredClone(raw) as Finality;
    message[4].sort(([a],[b])=>a-b);
    if (message[3] < this.finalTick) return result('stale');
    if (message[3] === this.finalTick) return result(message[5] === this.finalHash && canonical([...message[4]].sort()) === canonical([...this.finalPrefixes].sort()) ? 'stale' : 'invalid', message[5] !== this.finalHash || canonical(message[4]) !== canonical([...this.finalPrefixes].sort(([a],[b])=>a-b)));
    const previous = this.pendingFinality.get(message[3]);
    if (previous && canonical(message) !== canonical(previous)) return result('invalid', true);
    this.pendingFinality.set(message[3], message);
    if (this.pendingFinality.size > ROLLBACK_TICKS || this.retainedBytes > this.byteLimit) {
      if (previous) this.pendingFinality.set(message[3], previous); else this.pendingFinality.delete(message[3]);
      return result('overflow');
    }
    return this.tryFinality();
  }
  bootstrap(): Uint8Array {
    return packBootstrap(this.segment, this.stateAt(this.finalTick)!, this.finalPrefixes);
  }

  private tryFinality(): WorldResult {
    let message: Finality | undefined, state: DirectState | undefined;
    for (const candidate of [...this.pendingFinality.values()].sort((a,b)=>a[3]-b[3])) {
      const at = candidate[3];
      if (at > this.state.game.tick || [...this.streams.values()].some(s => !s.completeThrough(at))) continue;
      const reconstructed = this.stateAt(at);
      if (!reconstructed || candidate[4].some(([slot,seq])=>this.streams.get(slot)!.prefixAt(at)!==seq) || replayHash(reconstructed)!==candidate[5]) {
        this.pendingFinality.delete(at); return result('invalid', true);
      }
      message = candidate; state = reconstructed;
    }
    if (!message || !state) return result('waiting');
    const [, , , tick, prefixes, hash] = message;
    const checkpoint=packState(state),restored=readState(checkpoint);
    if(!restored||replayHash(restored)!==hash)return result('invalid',true);
    const events: CommittedEvent[] = [];
    for (const [at, entries] of [...this.candidate.events].sort(([a], [b]) => a - b)) if (at <= tick) entries.forEach((event, i) => events.push({ id: `${this.segment}:${at}:${i}`, tick: at, event }));
    const snapshots = new Map([...this.candidate.snapshots].filter(([at]) => at > tick)); snapshots.set(tick, checkpoint);
    const pendingEvents = new Map([...this.candidate.events].filter(([at]) => at > tick));
    const streams = new Map([...this.streams].map(([slot, stream]) => [slot, stream.trim(tick, state.gestures.get(slot)?.latest ?? 0)]));
    const candidate = { views: this.candidate.views, state: this.candidate.state, snapshots, events: pendingEvents, phaseChanges: new Set([...this.candidate.phaseChanges].filter(at => at > tick)) };
    const pending = new Map([...this.pendingFinality].filter(([at])=>at>tick));
    if (this.measure(candidate, streams, pending) > this.byteLimit) return result('overflow');
    this.finalTick = tick; this.finalHash = hash; this.finalPrefixes = structuredClone(prefixes); this.pendingFinality = pending;
    this.streams = streams; this.candidate = candidate;
    return { status: 'accepted', events, rollbackTicks: 0 };
  }
  private restoreBefore(tick: number): Candidate | undefined {
    const at = Math.max(...[...this.candidate.snapshots.keys()].filter(t => t < tick));
    const bytes = this.candidate.snapshots.get(at);
    if (!bytes) return;
    const state = readState(bytes);
    if (!state) return;
    return { views: new Map([...this.candidate.views].filter(([t]) => t <= at)), state, snapshots: new Map([...this.candidate.snapshots].filter(([t]) => t <= at)), events: new Map([...this.candidate.events].filter(([t]) => t <= at)), phaseChanges: new Set([...this.candidate.phaseChanges].filter(t => t <= at)) };
  }
  private stateAt(tick: number): DirectState | undefined {
    const exact = this.candidate.snapshots.get(tick);
    if (exact) return readState(exact);
    const base = this.restoreBefore(tick);
    return base ? this.simulate(base, this.streams, tick).state : undefined;
  }
  private simulate(candidate: Candidate, streams: ReadonlyMap<number, DirectStream>, target: number): Candidate {
    while (candidate.state.game.tick < target) {
      const tick = candidate.state.game.tick + 1;
      const phase = candidate.state.game.phase;
      const events = stepDirect(candidate.state, new Map([...streams].map(([slot, s]) => [slot, s.at(tick)])));
      if (events.length) candidate.events.set(tick, events);
      if (candidate.state.game.phase !== phase) candidate.phaseChanges.add(tick);
      candidate.views.set(tick, presentationFrame(candidate.state));
      while (candidate.views.size > 4) candidate.views.delete(candidate.views.keys().next().value!);
      if (tick % SNAPSHOT_INTERVAL === 0) candidate.snapshots.set(tick, packState(candidate.state));
    }
    return candidate;
  }
  private measure(candidate: Candidate, streams: ReadonlyMap<number, DirectStream>, pending: ReadonlyMap<number,Finality> = this.pendingFinality): number {
    if ([...candidate.snapshots.values()].some(bytes => bytes.byteLength > CHECKPOINT_BYTES)) return Infinity;
    return [...candidate.views.values()].reduce((sum, frame) => sum + frame.bytes, 0) + [...candidate.snapshots.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0)
      + [...streams.values()].reduce((sum, stream) => sum + packMessage([...stream.records.values()]).byteLength, 0)
      + [...streams.values()].reduce((sum, stream) => sum + packMessage([...stream.cuts]).byteLength, 0)
      + packMessage([...candidate.events]).byteLength + packMessage([...candidate.phaseChanges]).byteLength + packMessage([...pending.values()]).byteLength;
  }
}
