/**
 * Camera shake as trauma: events add to it, it drains with time, and the offset is its square, so small knocks
 * barely move the picture and a Queen's death throws it. Offsets are whole art pixels; the picture never blurs.
 */

/** The furthest the picture moves at full trauma, in art pixels. */
export const SHAKE_REACH = 5;
/** Trauma drained per second. */
export const SHAKE_DRAIN = 1.9;

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export class Shake {
  private trauma = 0;
  private clock = 0;

  /** The strongest knock wins a little more than it adds: two kills on one frame do not double the shake. */
  add(amount: number): void {
    const knock = Math.max(0, Math.min(1, amount));
    this.trauma = Math.min(1, Math.max(this.trauma, knock) + knock * 0.25);
  }

  tick(seconds: number): void {
    const dt = Math.max(0, seconds);
    this.clock += dt;
    this.trauma = Math.max(0, this.trauma - SHAKE_DRAIN * dt);
  }

  get level(): number {
    return this.trauma;
  }

  /** Two out-of-step waves instead of noise: the same clock gives the same offset, which a test can check. */
  offset(): Offset {
    const reach = this.trauma * this.trauma * SHAKE_REACH;
    if (reach <= 0) return { x: 0, y: 0 };
    const t = this.clock;
    return {
      x: Math.round(reach * Math.sin(t * 97 + Math.sin(t * 31) * 2)),
      y: Math.round(reach * 0.8 * Math.sin(t * 83 + 1.7 + Math.sin(t * 43))),
    };
  }
}
