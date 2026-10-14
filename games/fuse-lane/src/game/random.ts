/**
 * The room's seeded generator and the arithmetic the rules use. Everything here is built from + − × ÷ and rounding,
 * which IEEE 754 makes identical on every engine; `Math.log`/`exp`/`pow` are not guaranteed to be, so the rules
 * never call them (a Safari phone and a Chrome laptop must fold the same economy).
 */

/** Anything that carries the generator's state; the rules pass the room. */
export interface Seeded {
  rng: number;
}

/** mulberry32: one step of the generator. */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: next };
}
/** A uniform number in [0, 1); advances the generator. */
export function random(seeded: Seeded): number {
  const { value, state } = nextRandom(seeded.rng);
  seeded.rng = state;
  return value / 0x1_0000_0000;
}
/** A whole number in lo..hi inclusive, like SCI's Random(lo, hi). */
export function randInt(seeded: Seeded, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(random(seeded) * (hi - lo + 1));
}
/** True with probability p. */
export const chance = (seeded: Seeded, p: number): boolean =>
  random(seeded) < p;
/** Roughly a standard normal: four uniforms (Irwin–Hall), mean 0, variance 1, within ±3.46. */
export function normal(seeded: Seeded): number {
  const sum = random(seeded) + random(seeded) + random(seeded) + random(seeded);
  return (sum - 2) * 1.7320508075688772;
}
/** FNV-1a over a string: the seed every replica derives alike from the match id. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

export const clamp = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value;
/** Rounded to 4 decimals: rates and indices stay short, exact and comparable in a checkpoint. */
export const r4 = (value: number): number =>
  Math.round(value * 10_000) / 10_000;
/** Rounded to cents. */
export const r2 = (value: number): number => Math.round(value * 100) / 100;

const LN2 = 0.6931471805599453;
/** The natural log from basic arithmetic only (halving and an atanh series), for x > 0. */
export function ln(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  let k = 0;
  while (x >= 2) {
    x /= 2;
    k++;
  }
  while (x < 1) {
    x *= 2;
    k--;
  }
  const y = (x - 1) / (x + 1),
    y2 = y * y;
  let term = y,
    sum = 0;
  for (let n = 1; n < 41; n += 2) {
    sum += term / n;
    term *= y2;
  }
  return 2 * sum + k * LN2;
}
