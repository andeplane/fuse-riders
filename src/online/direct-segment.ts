import { toSnapshot } from '../shared/game.js';
import { uint32 } from '../shared/direct-input.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import { canonical } from '../shared/action-log.js';
import { isBoundControl } from './direct-control.js';
import { DirectHeartbeat, decodeHeartbeat, HEARTBEAT_FRESH_MS, type HeartbeatBody, type HeartbeatContext, type HeartbeatResult } from './direct-heartbeat.js';
import { DirectTickClock, FUTURE_RECORD_TICKS } from './direct-clock.js';
import { DirectOrigin, type OriginInput } from './direct-origin.js';
import { decodeDirectPacket, DirectDelivery, DIRECT_VERSION, FAST_PACKET_BYTES } from './direct-stream.js';
import { packMessage, unpackMessage } from './action-replication.js';
import { RollbackWorld, ROLLBACK_TICKS, type CommittedEvent, type Finality, type WorldResult } from './rollback-world.js';

export interface SegmentConfig {
  alias: number; id: string; coordinator: string; baseTick: number; running: boolean;
  owners: readonly (readonly [slot: number, peer: string])[]; views: readonly string[]; members: readonly string[];
  /** Full views receive a checkpoint; controllers never receive or retain one. */
  bootstrap?: Uint8Array; startAt?: number;
}
export interface SegmentPorts {
  now(): number;
  fast(peer: string, bytes: Uint8Array): boolean;
  pulse(peer: string, bytes: Uint8Array): boolean;
  reliable(peer: string, tuple: unknown[]): boolean;
  events(events: CommittedEvent[]): void;
  fault(reason: string, corrupt?: boolean): void;
}

/** Live segment orchestration shared by the browser runtime and deterministic network tests. */
export class DirectSegment {
  readonly config: Readonly<SegmentConfig>;
  private currentClock: DirectTickClock;
  private currentWorld?: RollbackWorld;
  get clock(): DirectTickClock { return this.currentClock; }
  get world(): RollbackWorld | undefined { return this.currentWorld; }
  private origins = new Map<number, DirectOrigin>();
  private deliveries = new Map<number, Map<string, DirectDelivery>>();
  private owners: Map<number, string>;
  private progress = new Map<number, { tick: number; at: number }>();
  private startedAt?: number;
  private heartbeats = new Map<string, DirectHeartbeat>();
  private demands = new Map<string, { target: number; at: number }>();
  private confirmation?: { target: number; at: number };
  private demandAdmitted = new Map<string, number>();
  private demandSent = new Map<string, number>();
  private lastConfirmationSent = -Infinity;
  private lastFinal = -Infinity;
  private finality?: Finality;
  private pendingFinality = new Map<string, { message: Finality; attempted: number }>();
  private finalView?: ViewSnapshot;
  private stopped?: string;
  private readonly initialAt: number;
  rollbackCount = 0;
  rollbackTicks = 0;
  constructor(config: SegmentConfig, private readonly ports: SegmentPorts) {
    const { alias, id, coordinator, baseTick, owners, views, members } = config;
    if (typeof config.running !== 'boolean' || !uint32(alias) || !alias || !uint32(baseTick) || members.some(p => typeof p !== 'string' || !p || p.length > 128) || members.length > 6 || new Set(members).size !== members.length || !members.includes(id) || !members.includes(coordinator)
      || views.length > 6 || new Set(views).size !== views.length || !views.includes(coordinator) || views.some(p => !members.includes(p))
      || owners.length > 5 || new Set(owners.map(o => o[0])).size !== owners.length || owners.some(([slot, peer]) => !uint32(slot) || slot > 4 || !members.includes(peer))) throw new Error('Invalid segment roster');
    const { bootstrap: _bootstrap, ...scope } = config;
    this.config = Object.freeze({ ...scope, owners: Object.freeze(owners.map(pair => Object.freeze([...pair] as const))), views: Object.freeze([...views]), members: Object.freeze([...members]) });
    this.owners = new Map(owners); this.initialAt = ports.now();
    if (views.includes(id)) {
      this.currentWorld = config.bootstrap && RollbackWorld.open(config.bootstrap, alias);
      if (!this.world || this.world.finalizedTick !== baseTick || this.world.state.game.players.size !== owners.length || [...this.world.state.game.players.values()].some(p => !this.owners.has(p.slot))) throw new Error('Invalid segment checkpoint');
      // Every replacement segment starts neutral, with a fresh sequence/gesture scope.
      if (this.world.finalizedPrefixes.some(([, seq]) => seq !== 0) || [...this.world.state.game.players.values()].some(p => p.bombTarget !== undefined || p.bombChargeStartedTick !== undefined) || [...this.world.state.held.values()].some(h => h.flags !== 0) || [...this.world.state.gestures.values()].some(g => g.active || g.latest)) throw new Error('Non-neutral replacement segment');
      this.refreshFinalView();
    } else if (config.bootstrap) throw new Error('Controller received a full world');
    this.currentClock = id === coordinator ? DirectTickClock.coordinator(alias, baseTick, ports.now, config.startAt ?? ports.now()) : DirectTickClock.follower(alias, baseTick, ports.now);
    for (const [slot, peer] of owners) {
      this.progress.set(slot, { tick: baseTick, at: this.initialAt });
      if (peer !== id) continue;
      this.origins.set(slot, DirectOrigin.start(alias, slot, baseTick));
      this.deliveries.set(slot, new Map(views.filter(p => p !== id).map(p => [p, new DirectDelivery(alias, slot, baseTick)])));
    }
    for (const peer of members) if (peer !== id) this.heartbeats.set(peer, new DirectHeartbeat(alias, id, peer, coordinator, {
      now: ports.now, body: context => this.heartbeatBody(peer, context), accept: body => this.acceptHeartbeat(peer, body), send: bytes => ports.pulse(peer, bytes),
    }));
  }
  get faultReason(): string | undefined { return this.stopped; }
  get finalizedTick(): number { return this.world?.finalizedTick ?? this.finality?.[3] ?? this.config.baseTick; }
  get inputSlots(): number[] { return [...this.origins.keys()]; }
  get retainedRecords(): number { return [...this.deliveries.values()].reduce((sum, peers) => sum + [...peers.values()].reduce((n, q) => n + q.retainedRecords, 0), 0); }
  revision(slot: number): number { return this.origins.get(slot)?.revision ?? -1; }
  private fail(reason: string, corrupt = false): void {
    if (this.stopped) return;
    this.stopped = reason;
    for (const heartbeat of this.heartbeats.values()) heartbeat.stop();
    this.origins = new Map([...this.origins].map(([slot, origin]) => [slot, origin.suspend()]));
    this.ports.fault(reason, corrupt);
  }
  stop(): void { this.stopped ??= 'Segment replaced'; for (const heartbeat of this.heartbeats.values()) heartbeat.stop(); this.origins.clear(); this.deliveries.clear(); this.pendingFinality.clear(); this.demands.clear(); this.confirmation = undefined; }
  input(slot: number, frame: OriginInput): boolean {
    const origin = this.origins.get(slot), reading = this.clock.read(true);
    if (!origin || !this.config.running || this.stopped) return false;
    if (!reading.canOriginate || reading.tick >= this.finalizedTick + ROLLBACK_TICKS) { this.fail('Input clock unavailable — synchronizing controls'); return false; }
    const prepared = origin.prepare(frame, reading.fractionalTick);
    if (prepared.status === 'stale') return true;
    if (prepared.status !== 'accepted') { this.fail('Input stream rejected — synchronizing controls'); return false; }
    const next = prepared.actions.length ? prepared.origin.advanceWatermark(reading.tick) : prepared.origin;
    if (!next) { this.fail('Invalid local progress cut'); return false; }
    const candidates = new Map<string, DirectDelivery>();
    for (const [peer, queue] of this.deliveries.get(slot)!) {
      const candidate = queue.prepare(prepared.actions);
      if (!candidate || !candidate.advanceCut(next.watermark)) { this.fail('Input repair history full — synchronizing controls'); return false; }
      candidates.set(peer, candidate);
    }
    if (this.world && prepared.actions.length) {
      const received = this.world.receive(slot, packMessage([DIRECT_VERSION, this.config.alias, slot, prepared.actions, next.watermark]), reading.tick);
      if (!this.result(received)) return false;
    }
    this.origins.set(slot, next); this.deliveries.set(slot, candidates); this.recordProgress(slot, next.watermark[0]);
    for (const [peer, queue] of candidates) { if (this.stopped) break; queue.publish(prepared.actions, this.ports.now(), bytes => this.ports.fast(peer, bytes)); }
    return !this.stopped;
  }
  private recordProgress(slot: number, tick: number): void {
    if (tick > this.progress.get(slot)!.tick) this.progress.set(slot, { tick, at: this.ports.now() });
  }
  /** Prepare the entire local progress update before installing or sending any subscriber data. */
  private publishCuts(send: boolean): boolean {
    const reading = this.clock.read();
    if (!reading.canOriginate || this.stopped || !this.config.running) return false;
    const tick = Math.min(reading.tick, this.finalizedTick + ROLLBACK_TICKS);
    const origins = new Map(this.origins), deliveries = new Map(this.deliveries);
    const cuts: [number, number, number][] = [];
    for (const [slot, origin] of this.origins) {
      const next = origin.advanceWatermark(tick);
      if (!next) { this.fail('Invalid local progress cut'); return false; }
      origins.set(slot, next); cuts.push([slot, ...next.watermark]);
      const queues = new Map<string, DirectDelivery>();
      for (const [peer, queue] of this.deliveries.get(slot)!) {
        const candidate = queue.prepare([]);
        if (!candidate || !candidate.advanceCut(next.watermark)) { this.fail('Invalid local progress cut'); return false; }
        queues.set(peer, candidate);
      }
      deliveries.set(slot, queues);
    }
    const prepared = this.world?.prepareProgress(cuts, null, reading.tick);
    if (prepared && !prepared.world) { this.result(prepared.outcome); return false; }
    if (prepared) this.currentWorld = prepared.world;
    this.origins = origins; this.deliveries = deliveries;
    for (const [slot] of origins) this.recordProgress(slot, tick);
    if (prepared && !this.result(prepared.outcome)) return false;
    let queued = true;
    if (send) for (const peers of deliveries.values()) for (const [peer, queue] of peers) {
      if (this.stopped) return false;
      queued = queue.flush(this.ports.now(), bytes => this.ports.fast(peer, bytes)) && queued;
    }
    return queued;
  }
  private heartbeatBody(peer: string, context: HeartbeatContext): HeartbeatBody {
    this.publishCuts(false);
    const cuts: HeartbeatBody[0] = this.config.views.includes(peer) && this.clock.read().canOriginate ? [...this.origins].map(([slot, origin]) => [slot, ...origin.watermark]) : [];
    const receipts: HeartbeatBody[1] = this.world?.streamProgress().filter(s => this.owners.get(s.slot) === peer).map(s => [s.slot, s.contiguous]) ?? [];
    const clock = peer === this.config.coordinator ? this.clock.request(context.id) : this.config.id === this.config.coordinator ? this.clock.reply(context.incoming?.[2]) : null;
    if (clock === undefined) this.fail('Simulation clock unavailable — synchronizing');
    return [cuts, receipts, clock ?? null, this.config.id === this.config.coordinator ? this.finality ?? null : null];
  }
  private controllerCertificate(raw: Finality): Finality | undefined {
    if (raw[3] < this.finalizedTick) return this.finality;
    if (raw[3] > this.finalizedTick + ROLLBACK_TICKS || raw[4].length !== this.owners.size || raw[4].some(([slot]) => !this.owners.has(slot))) return;
    const next = structuredClone(raw); next[4].sort(([a], [b]) => a - b);
    if (this.finality && (next[3] === this.finalizedTick ? canonical(next) !== canonical(this.finality) : next[4].some(([slot, seq]) => seq < this.finality![4].find(([prior]) => prior === slot)![1]))) return;
    return next;
  }
  private acceptHeartbeat(peer: string, [cuts, receipts, rawClock, certificate]: HeartbeatBody): boolean {
    if (cuts.some(([slot]) => !this.world || this.owners.get(slot) !== peer) || receipts.some(([slot]) => !this.deliveries.get(slot)?.has(peer))) return false;
    const queues = new Map(this.deliveries);
    for (const [slot, sequence] of receipts) {
      const candidate = queues.get(slot)!.get(peer)!.prepareReceipt(sequence);
      if (!candidate) return false;
      queues.set(slot, new Map(queues.get(slot)).set(peer, candidate));
    }
    const clock = rawClock?.[2] === 'time' ? this.clock.prepare(rawClock) : undefined;
    if (clock && clock.status !== 'accepted') { if (clock.status === 'fault') this.fail('Simulation clock changed — synchronizing'); return false; }
    const reading = (clock?.clock ?? this.clock).read();
    if (cuts.length && !reading.canOriginate) return false;
    const prepared = this.world?.prepareProgress(cuts, certificate, reading.tick);
    if (prepared && !prepared.world) { this.result(prepared.outcome); return false; }
    const finality = certificate && !this.world ? this.controllerCertificate(certificate) : undefined;
    if (certificate && !this.world && !finality) { this.fail('Conflicting coordinator progress — synchronizing', true); return false; }
    if (clock) this.currentClock = clock.clock;
    if (prepared) this.currentWorld = prepared.world;
    if (finality) this.finality = finality;
    this.deliveries = queues;
    for (const [slot, tick] of cuts) this.recordProgress(slot, tick);
    return !prepared || this.result(prepared.outcome);
  }
  receiveFast(peer: string, bytes: Uint8Array): HeartbeatResult | undefined {
    if (this.stopped || !this.config.members.includes(peer) || bytes.byteLength > FAST_PACKET_BYTES) return;
    if (decodeHeartbeat(bytes)) {
      const result = this.heartbeats.get(peer)?.receive(bytes);
      return this.stopped ? undefined : result;
    }
    const packet = decodeDirectPacket(bytes);
    if (packet) {
      if (!this.world || packet[1] !== this.config.alias || this.owners.get(packet[2]) !== peer) return;
      const reading = this.clock.read(); if (!reading.canOriginate) return;
      const before = this.world.streamProgress().find(s => s.slot === packet[2])!.contiguous;
      const outcome = this.world.receive(packet[2], bytes, reading.tick);
      if (!this.result(outcome)) return;
      const after = this.world.streamProgress().find(s => s.slot === packet[2])!.contiguous;
      if (outcome.receipt && (packet[3].length || after > before)) this.ports.fast(peer, outcome.receipt);
      if (packet[4]) this.recordProgress(packet[2], packet[4][0]);
      return;
    }
    try {
      const tuple = unpackMessage(bytes);
      if (Array.isArray(tuple) && tuple.length === 4 && tuple[0] === DIRECT_VERSION && tuple[1] === this.config.alias && uint32(tuple[2])) this.deliveries.get(tuple[2])?.get(peer)?.acknowledge(bytes);
    } catch { /* Malformed receipts never consume retained actions. */ }
  }
  receiveControl(peer: string, raw: unknown): void {
    if (this.stopped || !this.config.members.includes(peer) || !isBoundControl(raw) || raw[1] !== this.config.alias) return;
    if (raw[2] === 'settle' || raw[2] === 'confirm') { this.receiveDemand(peer, raw[2], raw[3]); return; }
    if (peer !== this.config.coordinator || raw[2] !== 'final') return;
    if (this.world) { this.result(this.world.finalize(raw)); return; }
    const next = this.controllerCertificate(raw);
    if (next) this.finality = next;
    else if (raw[3] >= this.finalizedTick) this.fail('Conflicting coordinator progress — synchronizing', true);
  }
  private receiveDemand(peer: string, kind: 'settle' | 'confirm', target: number): void {
    if (kind === 'settle' ? this.config.id !== this.config.coordinator || peer === this.config.id : peer !== this.config.coordinator || !this.origins.size) return;
    const now = this.ports.now(), reading = this.clock.read();
    if (!reading.canOriginate || target <= this.finalizedTick || target > this.finalizedTick + ROLLBACK_TICKS || target > reading.tick + FUTURE_RECORD_TICKS || now - (this.demandAdmitted.get(peer) ?? -Infinity) < 250) return;
    this.demandAdmitted.set(peer, now);
    if (kind === 'settle') { const old = this.demands.get(peer); this.demands.set(peer, { target: Math.min(target, old?.target ?? target), at: old?.at ?? now }); }
    else this.confirmation = { target: Math.min(target, this.confirmation?.target ?? target), at: this.confirmation?.at ?? now };
    this.serviceDemands();
  }
  private requestConfirmation(target: number): void {
    if (target <= this.finalizedTick) return;
    const old = this.demands.get(this.config.id);
    this.demands.set(this.config.id, { target: Math.min(target, old?.target ?? target), at: old?.at ?? this.ports.now() });
  }
  private serviceDemands(): void {
    const now = this.ports.now();
    for (const [peer, demand] of this.demands) if (this.finalizedTick >= demand.target) this.demands.delete(peer);
    if (this.confirmation && this.finalizedTick >= this.confirmation.target) this.confirmation = undefined;
    if ([...this.demands.values(), ...(this.confirmation ? [this.confirmation] : [])].some(d => now - d.at > 1500)) { this.fail('Progress confirmation expired — synchronizing'); return; }
    if (this.confirmation && now - this.lastConfirmationSent >= 250) {
      this.lastConfirmationSent = now;
      if (this.publishCuts(true) && [...this.origins.values()].every(o => o.watermark[0] >= this.confirmation!.target)) this.confirmation = undefined;
    }
    if (this.stopped || !this.demands.size) return;
    const target = Math.min(...[...this.demands.values()].map(d => d.target));
    if (this.config.id === this.config.coordinator) {
      if (now - (this.demandSent.get(this.config.id) ?? -Infinity) >= 250) { this.demandSent.set(this.config.id, now); this.publishCuts(true); }
      for (const owner of new Set(this.owners.values())) if (!this.stopped && owner !== this.config.id && now - (this.demandSent.get(owner) ?? -Infinity) >= 250) {
        this.demandSent.set(owner, now); this.ports.reliable(owner, [DIRECT_VERSION, this.config.alias, 'confirm', target]);
      }
    } else if (now - (this.demandSent.get(this.config.coordinator) ?? -Infinity) >= 250) {
      this.demandSent.set(this.config.coordinator, now); this.ports.reliable(this.config.coordinator, [DIRECT_VERSION, this.config.alias, 'settle', target]);
    }
  }
  private finalize(): void {
    const now = this.ports.now();
    if (this.config.id === this.config.coordinator && this.world && now - this.lastFinal >= 50) {
      const minimum = this.world.finalizedTick + (this.demands.size ? 1 : 20);
      for (let tick = this.world.state.game.tick; tick >= minimum; tick--) {
        const proposal = this.world.proposeFinality(tick); if (!proposal) continue;
        if (!this.result(this.world.finalize(proposal))) return;
        this.finality = proposal; this.lastFinal = now;
        for (const peer of this.config.members) if (peer !== this.config.id) this.pendingFinality.set(peer, { message: proposal, attempted: this.pendingFinality.get(peer)?.attempted ?? -Infinity });
        break;
      }
    }
  }
  tick(): void {
    const now = this.ports.now(); if (this.stopped) return;
    const active = [...this.origins.values()].some(o => o.activeControls) || !!this.world && [...this.world.state.held.values()].some(h => h.flags !== 0);
    const reading = this.clock.read(active);
    if (['clock-jump', 'discrepancy', 'exhausted'].includes(reading.reason)) { this.fail('Simulation clock unavailable — synchronizing'); return; }
    if (this.config.running && reading.canOriginate && this.startedAt === undefined) { this.startedAt = now; this.publishCuts(true); }
    if (this.config.running && reading.canAdvance && this.world && !this.result(this.world.advance(reading.tick))) return;
    if (this.config.running && reading.canOriginate) {
      const event = this.world?.pendingConfirmationTick;
      if (event !== undefined) this.requestConfirmation(event);
      if (reading.tick >= this.finalizedTick + 24) this.requestConfirmation(Math.min(reading.tick, this.finalizedTick + ROLLBACK_TICKS));
    }
    if (this.config.running) { this.serviceDemands(); if (reading.canOriginate) this.finalize(); }
    for (const heartbeat of this.heartbeats.values()) {
      if (this.stopped) return;
      if (heartbeat.exhausted) { this.fail('Heartbeat sequence exhausted — synchronizing'); return; }
      heartbeat.pump(!reading.canOriginate);
    }
    if (!this.config.running || this.stopped) return;
    for (const peers of this.deliveries.values()) for (const [peer, queue] of peers) queue.pump(now, bytes => this.ports.fast(peer, bytes));
    // A cut received during a synchronous heartbeat can make finality eligible immediately.
    this.finalize();
    for (const [peer, pending] of this.pendingFinality) if (now - pending.attempted >= 250) {
      pending.attempted = now;
      if (this.ports.reliable(peer, pending.message)) this.pendingFinality.delete(peer);
    }
    if (this.config.id === this.config.coordinator && this.startedAt !== undefined && [...this.progress.values()].some(p => p.tick > this.config.baseTick ? now - p.at > HEARTBEAT_FRESH_MS : now - this.startedAt! > 1500)) this.fail('A rider stopped publishing progress — synchronizing');
    if (!reading.canOriginate && active && reading.reason === 'stale') this.fail('Input clock stale — synchronizing controls');
  }
  private result(outcome: WorldResult): boolean {
    if (outcome.status === 'invalid' || outcome.status === 'overflow' || outcome.status === 'paused') { this.fail(`World ${outcome.status} — synchronizing`, !!outcome.corrupt); return false; }
    if (outcome.rollbackTicks) { this.rollbackCount++; this.rollbackTicks += outcome.rollbackTicks; }
    this.refreshFinalView();
    if (outcome.events.length) this.ports.events(outcome.events);
    return !this.stopped;
  }
  private refreshFinalView(): void {
    if (!this.world || this.finalView?.tick === this.world.finalizedTick) return;
    const state = this.world.finalizedState().game;
    this.finalView = { ...toSnapshot(state), tick: state.tick, round: state.round };
  }
  /** Current geometry with finalized score/outcome fields; rollback never replays committed notices/audio. */
  snapshot(): ViewSnapshot | undefined {
    if (!this.world || !this.finalView) return;
    const game = this.world.state.game, view = toSnapshot(game), final = this.finalView;
    return { ...view, tick: game.tick, round: game.round, phase: final.phase, phaseEndsAtTick: final.phaseEndsAtTick, roundWinnerId: final.roundWinnerId, matchWinnerId: final.matchWinnerId,
      leaderboard: final.leaderboard, roundPlacements: final.roundPlacements, matchStats: final.matchStats, players: view.players.map(p => { const outcome = final.players.find(f => f.id === p.id)!; return { ...p, alive: outcome.alive, roundWins: outcome.roundWins }; }) };
  }
}
