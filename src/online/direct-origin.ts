import { validAim, type AimTuple } from '../shared/action-log.js';
import { uint32, UINT32_MAX, type DirectAction } from '../shared/direct-input.js';
import type { Watermark } from './direct-stream.js';

export interface OriginInput {
  revision: number;
  left: boolean;
  right: boolean;
  bomb: boolean;
  bombAction?: 'press' | 'release' | 'cancel';
  aim: AimTuple;
}
interface OriginState {
  revision: number; sequence: number; lastTick: number; gesture: number; active: number;
  flags: number; aim: AimTuple; watermark: Watermark; suspended: boolean;
}
export type OriginResult = { status: 'accepted'; origin: DirectOrigin; actions: DirectAction[] } | { status: 'stale' | 'invalid' | 'exhausted' | 'suspended' };

/** Local UI revisions are not wire sequences. Candidates emit no bytes and do not change the live origin. */
export class DirectOrigin {
  private constructor(readonly segment: number, readonly slot: number, private readonly state: OriginState) {}
  static start(segment: number, slot: number, baseTick: number): DirectOrigin {
    if (!uint32(segment) || !segment || !uint32(slot) || slot > 4 || !uint32(baseTick)) throw new Error('Invalid origin scope');
    return new DirectOrigin(segment, slot, { revision: -1, sequence: 0, lastTick: baseTick, gesture: 0, active: 0, flags: 0, aim: null, watermark: [baseTick, 0], suspended: false });
  }
  get watermark(): Watermark { return [...this.state.watermark]; }
  /** A failed untimestamped release must not fire when a later clock sample arrives. Only a new scope resumes input. */
  suspend(): DirectOrigin { return new DirectOrigin(this.segment, this.slot, { ...this.state, suspended: true }); }

  prepare(input: OriginInput, clockTick: number): OriginResult {
    if (this.state.suspended) return { status: 'suspended' };
    if (!input || !uint32(input.revision) || typeof input.left !== 'boolean' || typeof input.right !== 'boolean' || typeof input.bomb !== 'boolean'
      || (input.bombAction !== undefined && !['press', 'release', 'cancel'].includes(input.bombAction))
      || (input.bombAction === 'press' && !input.bomb) || ((input.bombAction === 'release' || input.bombAction === 'cancel') && input.bomb)) return { status: 'invalid' };
    const aim = Array.isArray(input.aim) ? input.aim.map(n => Object.is(n, -0) ? 0 : n) : input.aim;
    if (!validAim(aim) || !Number.isFinite(clockTick) || clockTick < 0 || clockTick > UINT32_MAX) return { status: 'invalid' };
    if (input.revision <= this.state.revision) return { status: 'stale' };
    const tick = Math.max(Math.floor(clockTick) + 1, this.state.lastTick, this.state.watermark[0] + 1);
    if (!uint32(tick)) return { status: 'exhausted' };
    if (tick > Math.floor(clockTick) + 4) return { status: 'invalid' };
    const next: OriginState = { ...this.state, revision: input.revision, aim: structuredClone(aim) };
    const actions: DirectAction[] = [];
    const flags = Number(input.left) | (Number(input.right) << 1);
    if (flags !== next.flags) { next.flags = flags; actions.push([++next.sequence, tick, 0, flags]); }
    const releasing = input.bombAction === 'release' && next.active !== 0;
    if (!releasing && JSON.stringify(aim) !== JSON.stringify(this.state.aim)) actions.push([++next.sequence, tick, 4, structuredClone(aim)]);
    if (input.bombAction === 'press') {
      next.active = ++next.gesture;
      actions.push([++next.sequence, tick, 1, next.active]);
    } else if (next.active && (!input.bomb || input.bombAction === 'cancel')) {
      actions.push(releasing ? [++next.sequence, tick, 2, next.active, structuredClone(aim)] : [++next.sequence, tick, 3, next.active]);
      next.active = 0;
    }
    if (next.sequence > UINT32_MAX || next.gesture > UINT32_MAX) return { status: 'exhausted' };
    if (actions.length) next.lastTick = tick;
    return { status: 'accepted', origin: new DirectOrigin(this.segment, this.slot, next), actions };
  }

  /** Caller must also have a fresh, started clock; an issued future action prevents a premature exact cut. */
  advanceWatermark(tick: number): DirectOrigin | undefined {
    if (this.state.suspended || !uint32(tick) || tick < this.state.lastTick || tick < this.state.watermark[0]) return;
    return new DirectOrigin(this.segment, this.slot, { ...this.state, watermark: [tick, this.state.sequence] });
  }
}
