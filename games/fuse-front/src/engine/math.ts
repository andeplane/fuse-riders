/**
 * Integer arithmetic for the simulation. Every position is a whole number of sub-pixels and every timer a whole
 * number of steps, so a replay folds to the same bits on every device. The engine uses + − × and the truncating
 * division below only: no `Math` at all, not even `Math.imul` (`imul` here is the exact 32-bit product).
 */
export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

/** Integer division rounded toward zero, for whole-number operands. */
export const div = (a: number, b: number): number => (a - (a % b)) / b;

/** Integer division rounded up, for non-negative `a` and positive `b`. */
export const ceilDiv = (a: number, b: number): number => div(a + b - 1, b);

/** The low 32 bits of a × b as a signed integer, exactly as `Math.imul`. */
export function imul(a: number, b: number): number {
  const al = a & 0xffff,
    ah = (a >>> 16) & 0xffff,
    bl = b & 0xffff,
    bh = (b >>> 16) & 0xffff;
  return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}
