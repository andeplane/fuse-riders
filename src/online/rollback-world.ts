import { canonical, replayHash, validAim } from '../shared/action-log.js';
import { DIRECT_RULES, stepDirect, uint32, type DirectState } from '../shared/direct-input.js';
import type { GameEvent } from '../shared/protocol.js';
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
  receipt?: Uint8Array;
}
interface Candidate { state: DirectState; snapshots: Map<number, Uint8Array>; events: Map<number, GameEvent[]> }
const result = (status: WorldResult['status']): WorldResult => ({ status, events: [], rollbackTicks: 0 });

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
  private pendingFinality?: Finality;
  private finalTick: number;
  private finalHash: string;
  private finalPrefixes: StreamPrefixes;
  private constructor(readonly segment: number, state: DirectState, prefixes: StreamPrefixes, private readonly byteLimit: number) {
    this.finalTick = state.game.tick; this.finalHash = replayHash(state); this.finalPrefixes = structuredClone(prefixes);
    this.candidate = { state, snapshots: new Map([[state.game.tick, packState(state)]]), events: new Map() };
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
  get finalizedTick(): number { return this.finalTick; }
  get retainedBytes(): number { return this.measure(this.candidate, this.streams); }
  get retainedRecords(): number { return [...this.streams.values()].reduce((sum, s) => sum + s.records.size, 0); }
  get pendingFinalizedTick(): number | undefined { return this.pendingFinality?.[3]; }

  receive(ownerSlot: number, bytes: Uint8Array, localTargetTick: number): WorldResult {
    const packet = decodeDirectPacket(bytes);
    if (!packet || packet[2] !== ownerSlot || !this.streams.has(ownerSlot) || !uint32(localTargetTick)) return result('invalid');
    if (packet[1] !== this.segment) return result('stale');
    const received = this.streams.get(ownerSlot)!.receive(packet[3], packet[4], Math.min(localTargetTick, this.finalTick + ROLLBACK_TICKS) + 4);
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
    this.streams = streams; this.candidate = candidate;
    const receipt: DirectReceipt = [DIRECT_VERSION, this.segment, ownerSlot, received.stream.contiguous];
    const committed = this.tryFinality();
    return { ...committed, status: committed.status === 'waiting' ? 'accepted' : committed.status, receipt: packMessage(receipt), rollbackTicks };
  }

  advance(targetTick: number): WorldResult {
    if (!uint32(targetTick) || targetTick < this.state.game.tick) return result('invalid');
    const stop = Math.min(targetTick, this.finalTick + ROLLBACK_TICKS, this.state.game.tick + 8);
    const candidate = this.simulate({ state: structuredClone(this.candidate.state), snapshots: new Map(this.candidate.snapshots), events: new Map(this.candidate.events) }, this.streams, stop);
    if (this.measure(candidate, this.streams) > this.byteLimit) return result('overflow');
    this.candidate = candidate;
    const committed = this.tryFinality();
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
    const message = raw as Finality;
    if (message[3] < this.finalTick) return result('stale');
    if (message[3] === this.finalTick) return result(message[5] === this.finalHash && canonical([...message[4]].sort()) === canonical([...this.finalPrefixes].sort()) ? 'stale' : 'invalid');
    if (this.pendingFinality && message[3] < this.pendingFinality[3]) return result('stale');
    if (this.pendingFinality && message[3] === this.pendingFinality[3] && canonical(message) !== canonical(this.pendingFinality)) return result('invalid');
    this.pendingFinality = structuredClone(message);
    return this.tryFinality();
  }
  bootstrap(): Uint8Array {
    return packBootstrap(this.segment, this.stateAt(this.finalTick)!, this.finalPrefixes);
  }

  private tryFinality(): WorldResult {
    const message = this.pendingFinality;
    if (!message || message[3] > this.state.game.tick || [...this.streams.values()].some(s => !s.completeThrough(message[3]))) return result('waiting');
    const [, , , tick, prefixes, hash] = message;
    const state = this.stateAt(tick)!;
    if (prefixes.some(([slot, seq]) => this.streams.get(slot)!.prefixAt(tick) !== seq) || replayHash(state) !== hash) { this.pendingFinality = undefined; return result('invalid'); }
    const events: CommittedEvent[] = [];
    for (const [at, entries] of [...this.candidate.events].sort(([a], [b]) => a - b)) if (at <= tick) entries.forEach((event, i) => events.push({ id: `${this.segment}:${at}:${i}`, tick: at, event }));
    const snapshots = new Map([...this.candidate.snapshots].filter(([at]) => at > tick)); snapshots.set(tick, packState(state));
    const pendingEvents = new Map([...this.candidate.events].filter(([at]) => at > tick));
    const streams = new Map([...this.streams].map(([slot, stream]) => [slot, stream.trim(tick, state.gestures.get(slot)?.latest ?? 0)]));
    const candidate = { state: this.candidate.state, snapshots, events: pendingEvents };
    if (this.measure(candidate, streams) > this.byteLimit) return result('overflow');
    this.finalTick = tick; this.finalHash = hash; this.finalPrefixes = structuredClone(prefixes); this.pendingFinality = undefined;
    this.streams = streams; this.candidate = candidate;
    return { status: 'accepted', events, rollbackTicks: 0 };
  }
  private restoreBefore(tick: number): Candidate | undefined {
    const at = Math.max(...[...this.candidate.snapshots.keys()].filter(t => t < tick));
    const bytes = this.candidate.snapshots.get(at);
    if (!bytes) return;
    const state = readState(bytes);
    if (!state) return;
    return { state, snapshots: new Map([...this.candidate.snapshots].filter(([t]) => t <= at)), events: new Map([...this.candidate.events].filter(([t]) => t <= at)) };
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
      const events = stepDirect(candidate.state, new Map([...streams].map(([slot, s]) => [slot, s.at(tick)])));
      if (events.length) candidate.events.set(tick, events);
      if (tick % SNAPSHOT_INTERVAL === 0) candidate.snapshots.set(tick, packState(candidate.state));
    }
    return candidate;
  }
  private measure(candidate: Candidate, streams: ReadonlyMap<number, DirectStream>): number {
    if ([...candidate.snapshots.values()].some(bytes => bytes.byteLength > CHECKPOINT_BYTES)) return Infinity;
    return [...candidate.snapshots.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0)
      + [...streams.values()].reduce((sum, stream) => sum + packMessage([...stream.records.values()]).byteLength, 0)
      + [...streams.values()].reduce((sum, stream) => sum + packMessage([...stream.cuts]).byteLength, 0)
      + packMessage([...candidate.events]).byteLength;
  }
}
