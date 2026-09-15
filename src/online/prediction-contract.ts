import type { MotionControls } from '../shared/rider-motion.js';

/** Ticks without a fresh applied input before the host neutralizes held controls; the predictor mirrors it. */
export const CONTROL_FRESHNESS_TICKS = 20;
/** Scope is additional to the transport's authority incarnation/epoch fencing. */
export interface InputControlScope { matchId: string; round: number; controlEpoch: string }
export interface ScheduledMotionInput extends MotionControls { seq: number; intendedTick: number; scope: InputControlScope; resultAcks?: number[] }
export type MotionApplicationResult =
  | { seq: number; status: 'applied'; appliedTick: number }
  | { seq: number; status: 'superseded' | 'expired' };
export interface PredictionMotionContext {
  seed: number;
  drunkStartedTick: number;
  drunkUntilTick: number;
  drunkHeadingOffset: number;
}
/** Exactly the controls and motion context in authoritative state AFTER `tick`. */
export interface AppliedMotionState {
  scope: InputControlScope;
  tick: number;
  appliedSeq: number; // -1 means no movement sample has been applied in this control scope.
  appliedTick: number;
  held: MotionControls;
  results: readonly MotionApplicationResult[];
  motion: PredictionMotionContext;
}
/** Monotonic client timestamps; authorityTick is sampled at the host response send. */
export interface TickClockSample {
  scope: InputControlScope;
  localSentAt: number;
  localReceivedAt: number;
  authorityTick: number;
  paused: boolean;
}
export function sameControlScope(a: InputControlScope, b: InputControlScope): boolean {
  return a.matchId===b.matchId && a.round===b.round && a.controlEpoch===b.controlEpoch;
}
