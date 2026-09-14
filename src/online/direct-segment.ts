import { toSnapshot } from '../shared/game.js';
import { uint32 } from '../shared/direct-input.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import { canonical } from '../shared/action-log.js';
import { isBoundControl } from './direct-control.js';
import { DirectTickClock } from './direct-clock.js';
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
  reliable(peer: string, tuple: unknown[]): boolean;
  events(events: CommittedEvent[]): void;
  fault(reason: string, corrupt?: boolean): void;
}

/** Live segment orchestration shared by the browser runtime and deterministic network tests. */
export class DirectSegment {
  readonly config: Readonly<SegmentConfig>;
  readonly clock: DirectTickClock;
  readonly world?: RollbackWorld;
  private origins = new Map<number, DirectOrigin>();
  private deliveries = new Map<number, Map<string, DirectDelivery>>();
  private owners: Map<number, string>;
  private progress = new Map<number, { tick: number; at: number }>();
  private startedAt?: number;
  private lastProbe = -Infinity;
  private lastCut = -Infinity;
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
      this.world = config.bootstrap && RollbackWorld.open(config.bootstrap, alias);
      if (!this.world || this.world.finalizedTick !== baseTick || this.world.state.game.players.size !== owners.length || [...this.world.state.game.players.values()].some(p => !this.owners.has(p.slot))) throw new Error('Invalid segment checkpoint');
      // Every replacement segment starts neutral, with a fresh sequence/gesture scope.
      if (this.world.finalizedPrefixes.some(([, seq]) => seq !== 0) || [...this.world.state.game.players.values()].some(p => p.bombTarget !== undefined || p.bombChargeStartedTick !== undefined) || [...this.world.state.held.values()].some(h => h.flags !== 0) || [...this.world.state.gestures.values()].some(g => g.active || g.latest)) throw new Error('Non-neutral replacement segment');
      this.refreshFinalView();
    } else if (config.bootstrap) throw new Error('Controller received a full world');
    this.clock = id === coordinator ? DirectTickClock.coordinator(alias, baseTick, ports.now, config.startAt ?? ports.now()) : DirectTickClock.follower(alias, baseTick, ports.now);
    for (const [slot, peer] of owners) {
      this.progress.set(slot, { tick: baseTick, at: this.initialAt });
      if (peer !== id) continue;
      this.origins.set(slot, DirectOrigin.start(alias, slot, baseTick));
      this.deliveries.set(slot, new Map(views.filter(p => p !== id).map(p => [p, new DirectDelivery(alias, slot, baseTick)])));
    }
  }
  get faultReason(): string | undefined { return this.stopped; }
  get finalizedTick(): number { return this.world?.finalizedTick ?? this.finality?.[3] ?? this.config.baseTick; }
  get inputSlots(): number[] { return [...this.origins.keys()]; }
  get retainedRecords(): number { return [...this.deliveries.values()].reduce((sum, peers) => sum + [...peers.values()].reduce((n, q) => n + q.retainedRecords, 0), 0); }
  revision(slot: number): number { return this.origins.get(slot)?.revision ?? -1; }
  private fail(reason: string, corrupt = false): void {
    if (this.stopped) return;
    this.stopped = reason;
    this.origins = new Map([...this.origins].map(([slot, origin]) => [slot, origin.suspend()]));
    this.ports.fault(reason, corrupt);
  }
  stop(): void { this.stopped ??= 'Segment replaced'; this.origins.clear(); this.deliveries.clear(); this.pendingFinality.clear(); }
  input(slot: number, frame: OriginInput): boolean {
    const origin = this.origins.get(slot), reading = this.clock.read(true);
    if (!origin || !this.config.running || this.stopped) return false;
    if (!reading.canOriginate || reading.tick >= this.finalizedTick + ROLLBACK_TICKS) { this.fail('Input clock unavailable — synchronizing controls'); return false; }
    const prepared = origin.prepare(frame, reading.fractionalTick);
    if (prepared.status === 'stale') return true;
    if (prepared.status !== 'accepted') { this.fail('Input stream rejected — synchronizing controls'); return false; }
    const candidates = new Map<string, DirectDelivery>();
    for (const [peer, queue] of this.deliveries.get(slot)!) {
      const candidate = queue.prepare(prepared.actions);
      if (!candidate) { this.fail('Input repair history full — synchronizing controls'); return false; }
      candidates.set(peer, candidate);
    }
    if (this.world && prepared.actions.length) {
      const received = this.world.receive(slot, packMessage([DIRECT_VERSION, this.config.alias, slot, prepared.actions, origin.watermark]), reading.tick);
      if (!this.result(received)) return false;
    }
    this.origins.set(slot, prepared.origin); this.deliveries.set(slot, candidates);
    for (const [peer, queue] of candidates) { if (this.stopped) break; queue.publish(prepared.actions, this.ports.now(), bytes => this.ports.fast(peer, bytes)); }
    return true;
  }
  receiveFast(peer: string, bytes: Uint8Array): void {
    if (this.stopped || !this.config.members.includes(peer) || bytes.byteLength > FAST_PACKET_BYTES) return;
    const packet = decodeDirectPacket(bytes);
    if (packet) {
      if (!this.world || packet[1] !== this.config.alias || this.owners.get(packet[2]) !== peer) return;
      const reading = this.clock.read();
      if (!reading.canOriginate) return; // No qualified local target: bounded repair follows clock confirmation/recovery.
      const result = this.world.receive(packet[2], bytes, reading.tick);
      if (!this.result(result)) return;
      if (result.receipt) this.ports.fast(peer, result.receipt);
      const progress = this.progress.get(packet[2])!;
      if (packet[4] && packet[4][0] > progress.tick) this.progress.set(packet[2], { tick: packet[4][0], at: this.ports.now() });
      return;
    }
    try {
      const tuple = unpackMessage(bytes);
      if (Array.isArray(tuple) && tuple.length === 4 && tuple[0] === DIRECT_VERSION && tuple[1] === this.config.alias && uint32(tuple[2])) this.deliveries.get(tuple[2])?.get(peer)?.acknowledge(bytes);
    } catch { /* Malformed receipts never consume retained actions. */ }
  }
  receiveControl(peer: string, raw: unknown): void {
    if (this.stopped || !this.config.members.includes(peer) || !isBoundControl(raw) || raw[1] !== this.config.alias) return;
    if (raw[2] === 'clock' && this.config.id === this.config.coordinator) { const reply = this.clock.reply(raw); if (reply) this.ports.reliable(peer, reply); return; }
    if (peer !== this.config.coordinator) return;
    if (raw[2] === 'time') { if (this.clock.accept(raw) === 'fault') this.fail('Simulation clock changed — synchronizing'); return; }
    if (raw[2] !== 'final') return;
    if (this.world) { this.result(this.world.finalize(raw)); return; }
    // Controllers consume coordinator progress only; they do not claim independent world-hash verification.
    if (raw.length !== 6 || !uint32(raw[3]) || raw[3] < this.finalizedTick || raw[3] > this.finalizedTick + ROLLBACK_TICKS || !Array.isArray(raw[4]) || raw[4].length !== this.owners.size || typeof raw[5] !== 'string' || !/^[0-9a-f]{16}$/.test(raw[5])) return;
    const slots = new Set(this.owners.keys());
    if (raw[4].some(p => !Array.isArray(p) || p.length !== 2 || !uint32(p[0]) || !uint32(p[1]) || !slots.delete(p[0]))) return;
    const finality = structuredClone(raw); finality[4].sort(([a], [b]) => a - b);
    if (this.finality && (finality[3] === this.finalizedTick ? canonical(finality) !== canonical(this.finality) : finality[4].some(([slot, seq]) => seq < this.finality![4].find(([prior]) => prior === slot)![1]))) {
      this.fail('Conflicting coordinator progress — synchronizing', true); return;
    }
    this.finality = finality;
  }
  tick(): void {
    const now = this.ports.now();
    if (this.stopped) return;
    const active = [...this.origins.values()].some(o => o.activeControls) || !!this.world && [...this.world.state.held.values()].some(h => h.flags !== 0);
    const reading = this.clock.read(active);
    if (['clock-jump', 'discrepancy', 'exhausted'].includes(reading.reason)) { this.fail('Simulation clock unavailable — synchronizing'); return; }
    if (this.config.id !== this.config.coordinator && now - this.lastProbe >= (reading.canOriginate ? 500 : 100)) {
      this.lastProbe = now; const probe = this.clock.request(); if (probe) this.ports.reliable(this.config.coordinator, probe);
    }
    if (!this.config.running) return;
    if (reading.canOriginate) this.startedAt ??= now;
    if (reading.canAdvance && this.world && !this.result(this.world.advance(reading.tick))) return;
    if (reading.canOriginate && now - this.lastCut >= 100) {
      this.lastCut = now;
      for (const [slot, origin] of this.origins) {
        const cutTick = Math.min(reading.tick, this.finalizedTick + ROLLBACK_TICKS);
        const next = origin.advanceWatermark(cutTick); if (!next) continue;
        if (this.world && !this.result(this.world.receive(slot, packMessage([DIRECT_VERSION, this.config.alias, slot, [], next.watermark]), reading.tick))) return;
        this.origins.set(slot, next); this.progress.set(slot, { tick: cutTick, at: now });
        for (const [peer, queue] of this.deliveries.get(slot)!) {
          if (!queue.advanceCut(next.watermark)) { this.fail('Invalid local progress cut'); return; }
          queue.flush(now, bytes => this.ports.fast(peer, bytes));
        }
      }
    }
    for (const peers of this.deliveries.values()) for (const [peer, queue] of peers) queue.pump(now, bytes => this.ports.fast(peer, bytes));
    if (this.config.id === this.config.coordinator && this.world && now - this.lastFinal >= 100) {
      for (let tick = this.world.state.game.tick; tick > this.world.finalizedTick; tick--) {
        const proposal = this.world.proposeFinality(tick); if (!proposal) continue;
        if (!this.result(this.world.finalize(proposal))) return;
        this.finality = proposal; this.lastFinal = now;
        for (const peer of this.config.members) if (peer !== this.config.id) this.pendingFinality.set(peer, { message: proposal, attempted: -Infinity });
        break;
      }
    }
    for (const [peer, pending] of this.pendingFinality) if (now - pending.attempted >= 100) {
      pending.attempted = now;
      if (this.ports.reliable(peer, pending.message)) this.pendingFinality.delete(peer);
    }
    if (this.config.id === this.config.coordinator && this.startedAt !== undefined && [...this.progress.values()].some(p => p.tick > this.config.baseTick ? now - p.at > 500 : now - this.startedAt! > 1500)) this.fail('A rider stopped publishing progress — synchronizing');
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
