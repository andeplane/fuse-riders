import { uint32, UINT32_MAX } from '../shared/direct-input.js';
import { packMessage, unpackMessage } from './action-replication.js';
import { isBoundControl } from './direct-control.js';
import type { ClockProbe, ClockReply } from './direct-clock.js';
import type { Finality } from './rollback-world.js';
import { DIRECT_VERSION, FAST_PACKET_BYTES } from './direct-stream.js';

export const HEARTBEAT_INTERVAL_MS = 1000;
export const HEARTBEAT_RETRY_MS = 250;
export const HEARTBEAT_STARTUP_MS = 100;
export const HEARTBEAT_FRESH_MS = 2500;
export const HEARTBEAT_PENDING_LIMIT = 8;
export type HeartbeatCut = [slot: number, tick: number, sequence: number];
export type HeartbeatReceipt = [slot: number, sequence: number];
export type HeartbeatBody = [cuts: HeartbeatCut[], receipts: HeartbeatReceipt[], clock: ClockProbe | ClockReply | null, finality: Finality | null];
export type Heartbeat = [version: 1, alias: number, kind: 10 | 11, id: number, acknowledgement: number, body: HeartbeatBody];

function slots(raw: unknown, arity: number): boolean {
  if (!Array.isArray(raw) || raw.length > 5) return false;
  const seen = new Set<number>();
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== arity || !entry.every(uint32) || entry[0] > 4 || seen.has(entry[0])) return false;
    seen.add(entry[0]);
  }
  return true;
}

/** Exact shape and nested scope only; pair roles and stream permissions are checked before application. */
export function isHeartbeat(raw: unknown): raw is Heartbeat {
  if (!Array.isArray(raw) || raw.length !== 6 || raw[0] !== DIRECT_VERSION || !uint32(raw[1]) || !raw[1] || (raw[2] !== 10 && raw[2] !== 11) || !uint32(raw[3]) || !raw[3] || !uint32(raw[4]) || (raw[2] === 11 && !raw[4])) return false;
  const body = raw[5];
  if (!Array.isArray(body) || body.length !== 4 || !slots(body[0], 3) || !slots(body[1], 2)) return false;
  const clock = body[2], finality = body[3];
  if (clock !== null && (!isBoundControl(clock) || clock[1] !== raw[1] || clock[2] !== (raw[2] === 10 ? 'clock' : 'time') || clock[3] !== (raw[2] === 10 ? raw[3] : raw[4]))) return false;
  return finality === null || isBoundControl(finality) && finality[1] === raw[1] && finality[2] === 'final';
}

export function decodeHeartbeat(bytes: Uint8Array): Heartbeat | undefined {
  if (bytes.byteLength > FAST_PACKET_BYTES) return;
  try { const raw = unpackMessage(bytes); if (isHeartbeat(raw)) return raw; } catch { /* Invalid bytes never acknowledge an attempt. */ }
}

export function heartbeatInitiator(id: string, peer: string, coordinator: string): boolean {
  return peer === coordinator || id !== coordinator && id < peer;
}

export interface HeartbeatContext { kind: 10 | 11; id: number; acknowledgement: number; incoming?: HeartbeatBody }
export interface HeartbeatPorts {
  now(): number;
  /** Build a fresh candidate. A request's clock nonce must equal its allocated ID. */
  body(context: HeartbeatContext): HeartbeatBody;
  /** Validate all stream ownership/cut/clock/finality candidates before installing any of them. */
  accept(body: HeartbeatBody, context: HeartbeatContext): boolean;
  send(bytes: Uint8Array): boolean;
}
export interface HeartbeatResult { status: 'accepted' | 'stale' | 'invalid'; acknowledged: boolean }
const result = (status: HeartbeatResult['status'], acknowledged = false): HeartbeatResult => ({ status, acknowledged });

/** One elected exchange per pair. Fresh retry IDs avoid ambiguous RTT measurements. */
export class DirectHeartbeat {
  readonly initiator: boolean;
  private readonly clockRole: 'follower' | 'coordinator' | 'none';
  private nextId: number;
  private pending = new Map<number, number>();
  private lastIncoming = 0;
  private lastAcknowledgement = 0;
  private replyToAcknowledge = 0;
  private lastAttempt = -Infinity;
  private awaitingResponse = false;
  private lastObserved: number;
  private confirmedAt?: number;
  private stopped = false;
  constructor(readonly alias: number, id: string, peer: string, coordinator: string, private readonly ports: HeartbeatPorts, initialSequence = 0) {
    if (!uint32(alias) || !alias || !uint32(initialSequence) || id === peer || [id, peer, coordinator].some(p => typeof p !== 'string' || !p || p.length > 128)) throw new Error('Invalid heartbeat scope');
    this.nextId = initialSequence; this.lastObserved = ports.now();
    if (!Number.isFinite(this.lastObserved) || this.lastObserved < 0) throw new Error('Invalid heartbeat clock');
    this.initiator = heartbeatInitiator(id, peer, coordinator);
    this.clockRole = peer === coordinator ? 'follower' : id === coordinator ? 'coordinator' : 'none';
  }
  get pendingCount(): number { return this.pending.size; }
  get lastConfirmedAt(): number | undefined { return this.confirmedAt; }
  get exhausted(): boolean { return this.nextId === UINT32_MAX; }
  stop(): void { this.stopped = true; this.pending.clear(); this.confirmedAt = undefined; }
  private observe(): number {
    const now = this.ports.now();
    if (!Number.isFinite(now) || now < this.lastObserved) throw new Error('Invalid heartbeat clock');
    this.lastObserved = now;
    for (const [id, at] of this.pending) if (now - at > HEARTBEAT_FRESH_MS) this.pending.delete(id);
    return now;
  }
  /** Semantic direction constraints are independent of syntactic validity. */
  private roles(packet: Heartbeat, outgoing: boolean): boolean {
    const clock = packet[5][2], finality = packet[5][3];
    if (this.clockRole === 'none') return clock === null && finality === null;
    if (clock === null) return false;
    const fromCoordinator = outgoing ? this.clockRole === 'coordinator' : this.clockRole === 'follower';
    return (clock[2] === 'time') === fromCoordinator && (finality === null || fromCoordinator);
  }
  private emit(kind: 10 | 11, acknowledgement: number, incoming?: HeartbeatBody): boolean {
    if (this.stopped || this.exhausted) return false;
    const now = this.observe(), id = ++this.nextId;
    const body = this.ports.body({ kind, id, acknowledgement, incoming });
    if (this.stopped) return false;
    const packet: Heartbeat = [DIRECT_VERSION, this.alias, kind, id, acknowledgement, body];
    if (!isHeartbeat(packet) || !this.roles(packet, true)) throw new Error('Invalid local heartbeat body');
    const bytes = packMessage(packet);
    if (bytes.byteLength > FAST_PACKET_BYTES) throw new Error('Heartbeat exceeds byte limit');
    // Install before a synchronous injected transport can deliver the reply.
    this.pending.set(id, now);
    while (this.pending.size > HEARTBEAT_PENDING_LIMIT) this.pending.delete(this.pending.keys().next().value!);
    if (!this.ports.send(bytes) || this.stopped) { this.pending.delete(id); return false; }
    return true;
  }
  pump(qualifying = false): void {
    if (this.stopped || !this.initiator || this.exhausted) return;
    const now = this.observe();
    const interval = qualifying ? HEARTBEAT_STARTUP_MS : this.awaitingResponse ? HEARTBEAT_RETRY_MS : HEARTBEAT_INTERVAL_MS;
    if (now - this.lastAttempt < interval) return;
    this.lastAttempt = now;
    this.awaitingResponse = true;
    this.emit(10, this.replyToAcknowledge);
  }
  receive(bytes: Uint8Array): HeartbeatResult {
    if (this.stopped) return result('stale');
    const packet = decodeHeartbeat(bytes);
    if (!packet || packet[1] !== this.alias || (packet[2] === 11) !== this.initiator || !this.roles(packet, false)) return result('invalid');
    const now = this.observe(), [, , kind, id, acknowledgement, body] = packet;
    if (id <= this.lastIncoming) return result('stale');
    const sentAt = this.pending.get(acknowledgement);
    // Requests may repeat a previously accepted response ACK. Replies must always
    // identify a still-pending request. Clock samples additionally require <=500 ms;
    // other pairs retain the full bounded liveness window.
    if (kind === 11 && (sentAt === undefined || now - sentAt > (this.clockRole === 'none' ? HEARTBEAT_FRESH_MS : 500) || acknowledgement <= this.lastAcknowledgement)) return result('stale');
    if (kind === 10 && acknowledgement > this.nextId) return result('invalid');
    const accepted = this.ports.accept(body, { kind, id, acknowledgement });
    if (this.stopped) return result('stale');
    if (!accepted) return result('invalid');
    this.lastIncoming = id;
    const acknowledged = sentAt !== undefined && acknowledgement > this.lastAcknowledgement;
    if (acknowledged) {
      this.lastAcknowledgement = acknowledgement; this.confirmedAt = now;
      for (const pendingId of this.pending.keys()) if (pendingId <= acknowledgement) this.pending.delete(pendingId);
    }
    if (kind === 11) { this.replyToAcknowledge = id; this.pending.clear(); this.awaitingResponse = false; }
    else this.emit(11, id, body);
    return this.stopped ? result('stale') : result('accepted', acknowledged);
  }
}
