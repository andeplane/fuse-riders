/**
 * Seeded PRNG (mulberry32). The generator is one uint32 kept on the round state, so the state stays plain data and a
 * rollback or a checkpoint restores the stream exactly. Only integers come out: no float ever reaches the state.
 */

export interface RngHolder {
  rng: number;
}

/** Mixes a seed and a salt into a well-spread uint32. */
export function hashSeed(seed: number, salt = 0): number {
  let h =
    (Math.trunc(seed) ^ 0x9e3779b9 ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The next uint32 of the stream. */
export function nextU32(r: RngHolder): number {
  r.rng = (r.rng + 0x6d2b79f5) >>> 0;
  let t = r.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform integer in [0, n); 0 when n < 1. The product stays below 2^53, so the division is exact. */
export function randInt(r: RngHolder, n: number): number {
  if (n < 1) return 0;
  return Math.floor((nextU32(r) * n) / 4294967296);
}

/** Uniform integer in [-spread, spread]. */
export function randSpread(r: RngHolder, spread: number): number {
  return randInt(r, 2 * spread + 1) - spread;
}

/** True `percent` times in a hundred. */
export function chance(r: RngHolder, percent: number): boolean {
  return randInt(r, 100) < percent;
}
