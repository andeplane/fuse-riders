import { canonical } from '../shared/action-log.js';
import { isDirectAction, uint32, type DirectAction } from '../shared/direct-input.js';
import { packMessage, unpackMessage } from './action-replication.js';

export const DIRECT_VERSION = 1;
export const FAST_PACKET_BYTES = 512;
export const STREAM_RECORD_LIMIT = 256;
export type Watermark = [throughTick: number, lastIssuedSequence: number];
export type DirectPacket = [version: 1, segment: number, slot: number, actions: DirectAction[], watermark: Watermark | null];
export type DirectReceipt = [version: 1, segment: number, slot: number, sequence: number];
export const isWatermark = (v: unknown): v is Watermark => Array.isArray(v) && v.length === 2 && v.every(uint32);

export function decodeDirectPacket(bytes: Uint8Array): DirectPacket | undefined {
  if (bytes.byteLength > FAST_PACKET_BYTES) return;
  try {
    const v = unpackMessage(bytes);
    if (Array.isArray(v) && v.length === 5 && v[0] === DIRECT_VERSION && uint32(v[1]) && v[1] > 0 && uint32(v[2]) && v[2] < 5 && Array.isArray(v[3]) && v[3].length <= 4 && v[3].every(isDirectAction) && (v[4] === null || isWatermark(v[4]))) return v as DirectPacket;
  } catch { /* Invalid wire data never changes the stream. */ }
}

export interface StreamBase { sequence: number; tick: number; gesture: number }
export type StreamResult = { status: 'accepted'; stream: DirectStream; added: DirectAction[] } | { status: 'invalid' | 'overflow' };

/** A bounded immutable-candidate ledger. Receipt is contiguous possession, never finality. */
export class DirectStream {
  readonly records = new Map<number, DirectAction>();
  readonly cuts = new Map<number, number>();
  contiguous: number;
  watermark: Watermark;
  constructor(readonly base: StreamBase) {
    this.contiguous = base.sequence;
    this.watermark = [base.tick, base.sequence];
    this.cuts.set(base.tick, base.sequence);
  }

  receive(actions: readonly DirectAction[], watermark: Watermark | null, maxTick: number): StreamResult {
    const next = new DirectStream({ ...this.base });
    next.contiguous = this.contiguous; next.watermark = [...this.watermark];
    for (const [tick, seq] of this.cuts) next.cuts.set(tick, seq);
    for (const [seq, action] of this.records) next.records.set(seq, action);
    for (const action of actions) {
      if (!isDirectAction(action)) return { status: 'invalid' };
      // Finalized identities have been evicted, but their sequence fence never is.
      if (action[0] <= this.base.sequence) continue;
      if (action[1] <= this.base.tick || action[1] > maxTick) return { status: 'invalid' };
      if (action[0] - this.base.sequence > STREAM_RECORD_LIMIT) return { status: 'overflow' };
      const old = next.records.get(action[0]);
      if (old && canonical(old) !== canonical(action)) return { status: 'invalid' };
      next.records.set(action[0], structuredClone(action));
    }
    if (watermark !== null) {
      if (!isWatermark(watermark) || watermark[0] > maxTick) return { status: 'invalid' };
      const [tick, sequence] = watermark;
      if (tick < this.base.tick) {
        if (sequence > this.base.sequence) return { status: 'invalid' };
      } else {
        if (sequence < this.base.sequence || sequence - this.base.sequence > STREAM_RECORD_LIMIT || (next.cuts.has(tick) && next.cuts.get(tick) !== sequence)) return { status: 'invalid' };
        next.cuts.set(tick, sequence);
        if (next.cuts.size > 64) return { status: 'overflow' };
        if (tick > next.watermark[0]) next.watermark = [...watermark];
      }
    }
    let previousCutSequence = this.base.sequence;
    for (const [, sequence] of [...next.cuts].sort(([a], [b]) => a - b)) {
      if (sequence < previousCutSequence) return { status: 'invalid' };
      previousCutSequence = sequence;
    }
    let lastTick = this.base.tick, gesture = this.base.gesture;
    for (const [seq, action] of [...next.records].sort(([a], [b]) => a - b)) {
      for (const [through, issued] of next.cuts) if ((seq <= issued && action[1] > through) || (seq > issued && action[1] <= through)) return { status: 'invalid' };
      if (action[1] < lastTick) return { status: 'invalid' };
      lastTick = action[1];
      if (action[2] === 1) {
        if (action[3] <= gesture) return { status: 'invalid' };
        gesture = action[3];
      }
    }
    while (next.records.has(next.contiguous + 1)) next.contiguous++;
    const added: DirectAction[] = [];
    for (let seq = this.contiguous + 1; seq <= next.contiguous; seq++) added.push(next.records.get(seq)!);
    return { status: 'accepted', stream: next, added };
  }

  completeThrough(tick: number): boolean { return [...this.cuts].some(([through, seq]) => through >= tick && this.contiguous >= seq); }
  prefixAt(tick: number): number {
    let prefix = this.base.sequence;
    for (let seq = prefix + 1; seq <= this.contiguous; seq++) {
      if (this.records.get(seq)![1] > tick) break;
      prefix = seq;
    }
    return prefix;
  }
  at(tick: number): DirectAction[] {
    return [...this.records.values()].filter(a => a[0] <= this.contiguous && a[1] === tick).sort((a, b) => a[0] - b[0]);
  }
  trim(tick: number, gesture: number): DirectStream {
    const stream = new DirectStream({ sequence: this.prefixAt(tick), tick, gesture });
    stream.contiguous = this.contiguous; stream.watermark = [...this.watermark];
    for (const [through, seq] of this.cuts) if (through > tick) stream.cuts.set(through, seq);
    for (const [seq, action] of this.records) if (seq > stream.base.sequence) stream.records.set(seq, action);
    return stream;
  }
}

/** One origin-to-subscriber queue. Share immutable records across subscribers in the runtime. */
export class DirectDelivery {
  private pending: DirectAction[] = [];
  private acknowledged = 0;
  private lastSequence = 0;
  private lastTick: number;
  private watermark: Watermark;
  private lastSent = -Infinity;
  private repairAfter = 0;
  constructor(readonly segment: number, readonly slot: number, initialTick: number) {
    if (!uint32(segment) || segment === 0 || !uint32(slot) || slot > 4 || !uint32(initialTick)) throw new Error('Invalid delivery scope');
    this.lastTick = initialTick; this.watermark = [initialTick, 0];
  }
  get retainedRecords(): number { return this.pending.length; }
  /** Prepare a complete local edge group without publishing or changing this subscriber queue. */
  prepare(actions: readonly DirectAction[]): DirectDelivery | undefined {
    if (actions.length > 3 || this.pending.length + actions.length > STREAM_RECORD_LIMIT) return;
    const next = new DirectDelivery(this.segment, this.slot, this.watermark[0]);
    next.pending = [...this.pending]; next.acknowledged = this.acknowledged; next.lastSequence = this.lastSequence;
    next.lastTick = this.lastTick; next.watermark = [...this.watermark]; next.lastSent = this.lastSent; next.repairAfter = this.repairAfter;
    for (const action of actions) {
      if (!isDirectAction(action) || action[0] !== next.lastSequence + 1 || action[1] < next.lastTick || action[1] <= next.watermark[0]) return;
      next.pending.push(structuredClone(action)); next.lastSequence = action[0]; next.lastTick = action[1];
    }
    return next;
  }
  /** Install all subscriber candidates first, then send their admitted group; a failed send stays queued. */
  publish(actions: readonly DirectAction[], now: number, send: (bytes: Uint8Array) => boolean): void {
    if (!actions.length) return;
    const selected = actions.map(a => this.pending.find(p => p[0] === a[0]));
    if (actions.length > 3 || selected.some(a => !a)) return;
    const records = this.selectRepair(selected as DirectAction[]);
    this.lastSent = now;
    send(packMessage([DIRECT_VERSION, this.segment, this.slot, records, this.watermark] satisfies DirectPacket));
  }
  enqueue(action: DirectAction, now: number, send: (bytes: Uint8Array) => boolean): boolean {
    if (!isDirectAction(action) || action[0] !== this.lastSequence + 1 || action[1] < this.lastTick || action[1] <= this.watermark[0] || this.pending.length >= STREAM_RECORD_LIMIT) return false;
    this.pending.push(structuredClone(action)); this.lastSequence = action[0]; this.lastTick = action[1];
    this.transmit(now, send, action);
    return true;
  }
  advanceWatermark(tick: number): boolean {
    if (!uint32(tick) || tick < this.lastTick || tick < this.watermark[0]) return false;
    return this.advanceCut([tick, this.lastSequence]);
  }
  /** The origin certifies the exact prefix through this tick, even while later actions are queued. */
  advanceCut(cut: Watermark): boolean {
    if (!isWatermark(cut) || cut[0] < this.watermark[0] || cut[1] < this.watermark[1] || cut[1] > this.lastSequence || (cut[0] === this.watermark[0] && cut[1] !== this.watermark[1])
      || (this.lastTick <= cut[0] && cut[1] !== this.lastSequence) || this.pending.some(a => a[0] <= cut[1] ? a[1] > cut[0] : a[1] <= cut[0])) return false;
    this.watermark = [...cut]; return true;
  }
  acknowledge(bytes: Uint8Array): boolean {
    if (bytes.byteLength > FAST_PACKET_BYTES) return false;
    try {
      const v = unpackMessage(bytes);
      if (!Array.isArray(v) || v.length !== 4 || v[0] !== DIRECT_VERSION || v[1] !== this.segment || v[2] !== this.slot || !uint32(v[3]) || v[3] < this.acknowledged || v[3] > this.lastSequence) return false;
      this.acknowledged = v[3]; this.pending = this.pending.filter(a => a[0] > this.acknowledged); return true;
    } catch { return false; }
  }
  pump(now: number, send: (bytes: Uint8Array) => boolean): void {
    if (now - this.lastSent >= (this.pending.length ? 50 : 100)) this.transmit(now, send);
  }
  /** A newly published exact cut should not wait for a separately phased idle-retry timer. */
  flush(now: number, send: (bytes: Uint8Array) => boolean): void { this.transmit(now, send); }
  /** Keep the earliest gap covered while lost receipts cannot starve the rest of the retained suffix. */
  private selectRepair(newest: readonly DirectAction[]): DirectAction[] {
    const records = [...newest], earliest = this.pending[0];
    if (earliest && !records.some(a => a[0] === earliest[0])) records.push(earliest);
    const available = this.pending.filter(a => !records.some(selected => selected[0] === a[0]));
    const rotated = [...available.filter(a => a[0] > this.repairAfter), ...available.filter(a => a[0] <= this.repairAfter)];
    for (const action of rotated.slice(0, 4 - records.length)) { records.push(action); this.repairAfter = action[0]; }
    return records;
  }
  private transmit(now: number, send: (bytes: Uint8Array) => boolean, newest?: DirectAction): void {
    const records = this.selectRepair(newest ? [newest] : []);
    const packet: DirectPacket = [DIRECT_VERSION, this.segment, this.slot, records, this.watermark];
    // Max four fixed-schema records fit 512 bytes, including float64 aim and uint32 IDs.
    const bytes = packMessage(packet);
    this.lastSent = now; // A failed enqueue still consumes this repair pacing opportunity.
    send(bytes);
  }
}
