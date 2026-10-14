/** Hits on one castle closer together than this (ms) add up on the same damage number. */
export const TALLY_GAP = 450;
/** How fast (px/s) a damage number rises once the hits stop. */
export const TALLY_RISE = 45;

/** A castle's running damage total. */
export interface TallyState {
  total: number;
  /** Time (ms) of the latest hit. */
  last: number;
}

export interface TallyHit {
  tally: TallyState;
  /** True when the hit starts a new label instead of adding to the running one. */
  fresh: boolean;
  /** The number to show, as a whole number of at least 1. */
  shown: number;
  /** True when `shown` differs from what the label showed before this hit. */
  changed: boolean;
  /** Pop scale the label jumps to on this hit, and the scale it settles at. */
  s0: number;
  s1: number;
}

/**
 * Adds `damage` at time `now` to a castle's running tally, starting a new one when the last hit is more than
 * `TALLY_GAP` ago. The caller resets the label's age on every hit, which with `driftY` puts it back on its anchor,
 * so the number stays on the castle under sustained fire and only rises away once the hits stop.
 */
export function addHit(
  prev: TallyState | undefined,
  now: number,
  damage: number,
): TallyHit {
  const fresh = !prev || now - prev.last > TALLY_GAP;
  const tally = fresh ? { total: 0, last: now } : prev;
  const before = fresh ? 0 : Math.max(1, Math.round(tally.total));
  tally.total += damage;
  tally.last = now;
  const shown = Math.max(1, Math.round(tally.total));
  return {
    tally,
    fresh,
    shown,
    changed: fresh || shown !== before,
    s0: Math.min(2.2, 1.3 + damage / 40),
    s1: Math.min(1.6, 1 + tally.total / 150),
  };
}

/** Height of a drifting label `age` ms after it was (re)started at `y0`, moving at `vy` px/s. */
export const driftY = (y0: number, vy: number, age: number): number =>
  y0 + (vy * age) / 1000;
