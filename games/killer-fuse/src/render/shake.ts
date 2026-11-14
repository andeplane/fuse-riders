/**
 * Camera shake. The arcade shakes the picture for one thing only, a Queen's death: about two pixels for eight tenths
 * of a second. So a knock of 1 is that, smaller knocks are shorter and weaker, and the strength runs out evenly.
 * Offsets are whole art pixels; the picture never blurs.
 */

/** The furthest the picture moves at full strength, in art pixels. */
export const SHAKE_REACH = 2;
/** Seconds a full knock lasts. */
export const SHAKE_SECONDS = 0.8;

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export class Shake {
  private trauma = 0;
  private clock = 0;

  /** The strongest knock wins: two on one frame do not double the shake. */
  add(amount: number): void {
    this.trauma = Math.max(this.trauma, Math.max(0, Math.min(1, amount)));
  }

  tick(seconds: number): void {
    const dt = Math.max(0, seconds);
    this.clock += dt;
    this.trauma = Math.max(0, this.trauma - dt / SHAKE_SECONDS);
  }

  get level(): number {
    return this.trauma;
  }

  /** Two out-of-step waves instead of noise: the same clock gives the same offset, which a test can check. */
  offset(): Offset {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    // Full reach for most of the shake, easing off only at its very end.
    const reach = SHAKE_REACH * Math.min(1, this.trauma * 3);
    const t = this.clock;
    return {
      x: Math.round(reach * Math.sin(t * 97 + Math.sin(t * 31) * 2)),
      y: Math.round(reach * Math.sin(t * 83 + 1.7 + Math.sin(t * 43))),
    };
  }
}
