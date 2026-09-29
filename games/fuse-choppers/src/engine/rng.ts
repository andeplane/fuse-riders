/**
 * The two sources of randomness: `hash` for the level, a pure function of the round seed and a position, so the
 * cave needs no state; and `next`, a mulberry32 stream the world carries for everything that happens during play.
 */

/** Mixes 32-bit integers into one, evenly: the level generator's only randomness. */
export function hash(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** `hash` as an integer in `[low, high]`. */
export const hashRange = (
  low: number,
  high: number,
  ...values: number[]
): number => low + (hash(...values) % (high - low + 1));

/** One mulberry32 step: the value and the next state. */
export function next(state: number): { value: number; state: number } {
  const advanced = (state + 0x6d2b79f5) >>> 0;
  let t = advanced;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: advanced };
}

/** FNV-1a over a string: how a match id becomes a seed every replica derives alike. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    h = Math.imul(h ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return h;
}
