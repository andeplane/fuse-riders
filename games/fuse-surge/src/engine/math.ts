/**
 * Integer arithmetic for the simulation, so a replay folds to the same bits on every device: + − × and truncating
 * division only, never `Math.sqrt` or trigonometry.
 */

/** Integer division rounded toward zero; the `+ 0` turns a negative zero into plain zero, so state never holds one. */
export const div = (a: number, b: number): number => Math.trunc(a / b) + 0;

/** `value` moved toward `goal` by at most `by` (positive), never past it. */
export const approach = (value: number, goal: number, by: number): number =>
  value < goal
    ? value + by > goal
      ? goal
      : value + by
    : value - by < goal
      ? goal
      : value - by;

/** One xorshift32 step: the world's generator advances only through this, so it is part of the checkpoint. */
export function xorshift(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x === 0 ? 0x9e3779b9 : x;
}

/** A 32-bit seed from text (FNV-1a), never zero: a match id seeds its world the same way on every device. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h === 0 ? 0x9e3779b9 : h;
}

/** A well-mixed 32-bit value from a few integers, for decisions that must not move the world's generator. */
export function mix(...values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h = Math.imul(h ^ (value & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((value >>> 16) & 0xffff), 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}
