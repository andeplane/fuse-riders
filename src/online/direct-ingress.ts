import { uint32 } from '../shared/direct-input.js';
import { FAST_PACKET_BYTES } from './direct-stream.js';

export interface FastPermissions { actions: readonly number[]; receipts: readonly number[] }
type FlowKind = 'action' | 'receipt';
class Bucket {
  private tokens: number;
  constructor(private readonly rate: number, private readonly burst: number, private at: number) { this.tokens = burst; }
  take(now: number): boolean {
    if (!Number.isFinite(now) || now < this.at) return false;
    this.tokens = Math.min(this.burst, this.tokens + (now - this.at) * this.rate / 1000); this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}

/** Association-wide ingress cap with roster-authorized per-slot flows and reserved liveness capacity. */
export class DirectIngress {
  private readonly total: Bucket;
  private readonly probes: Bucket;
  private binding?: { alias: number; key: string };
  private flows = new Map<number, { kind: FlowKind; bucket: Bucket }>();
  constructor(now: number) {
    if (!Number.isFinite(now) || now < 0) throw new Error('Invalid ingress clock');
    this.total = new Bucket(750, 1500, now); this.probes = new Bucket(20, 40, now);
  }
  bind(alias: number, permissions: FastPermissions, now: number): boolean {
    if (!uint32(alias) || !alias || !Number.isFinite(now) || now < 0 || !permissions || !Array.isArray(permissions.actions) || !Array.isArray(permissions.receipts)) return false;
    const slots = [...permissions.actions, ...permissions.receipts];
    if (slots.length > 5 || new Set(slots).size !== slots.length || slots.some(slot => !uint32(slot) || slot > 4)) return false;
    const key = JSON.stringify([[...permissions.actions].sort(), [...permissions.receipts].sort()]);
    if (this.binding && alias <= this.binding.alias) return alias === this.binding.alias && key === this.binding.key;
    this.flows = new Map<number, { kind: FlowKind; bucket: Bucket }>([...permissions.actions.map(slot => [slot, { kind: 'action', bucket: new Bucket(140, 280, now) }] as const), ...permissions.receipts.map(slot => [slot, { kind: 'receipt', bucket: new Bucket(140, 280, now) }] as const)]);
    this.binding = { alias, key }; return true;
  }
  /** One reserved control allowance for the whole pulse; each nested flow still needs ownership. */
  heartbeat(cuts: readonly (readonly [number, number, number])[], receipts: readonly (readonly [number, number])[], now: number): 'accepted' | 'unauthorized' | 'limited' {
    if (cuts.some(([slot]) => this.flows.get(slot)?.kind !== 'action') || receipts.some(([slot]) => this.flows.get(slot)?.kind !== 'receipt')) return 'unauthorized';
    return this.flow('probe', 0, now);
  }
  /** Called before packet parsing, including wrong-scope/unauthorized traffic. */
  packet(bytes: number, now: number): boolean { return Number.isInteger(bytes) && bytes >= 0 && bytes <= FAST_PACKET_BYTES && this.total.take(now); }
  flow(kind: FlowKind | 'probe', slot: number, now: number): 'accepted' | 'unauthorized' | 'limited' {
    if (kind === 'probe') return this.probes.take(now) ? 'accepted' : 'limited';
    const flow = this.flows.get(slot);
    if (!flow || flow.kind !== kind) return 'unauthorized';
    return flow.bucket.take(now) ? 'accepted' : 'limited';
  }
}
