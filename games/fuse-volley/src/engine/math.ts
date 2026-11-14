/**
 * Integer arithmetic for the simulation, so a replay folds to the same bits on every device: + − × and truncating
 * division only, and an integer square root, never `Math.sqrt` or trigonometry.
 */

/** Integer division rounded toward zero; the `+ 0` turns a negative zero into plain zero, so state never holds one. */
export const div = (a: number, b: number): number => Math.trunc(a / b) + 0;

/** `a / b` rounded half away from zero, for a positive `b`. */
export function round(a: number, b: number): number {
  const sign = a < 0 ? -1 : 1;
  return div(2 * a + sign * b, 2 * b);
}

export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export const abs = (value: number): number => (value < 0 ? -value : value);

/** floor(√n) for a non-negative integer below 2^52, by Newton's method from a power-of-two guess. */
export function isqrt(n: number): number {
  if (n < 2) return n < 0 ? 0 : n;
  let guess = 1;
  while (guess * guess < n) guess *= 2;
  let x = guess;
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2);
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

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
