// Seeded PRNG (mulberry32). The generator state is a single uint32 stored on the owner object, so
// a round state stays plain data that can be cloned or serialised.

export interface RngHolder {
  rng: number;
}

/** Mixes an arbitrary number (and optional salt) into a well-spread uint32 seed. */
export function hashSeed(seed: number, salt = 0): number {
  let h =
    (Math.floor(seed) ^ 0x9e3779b9 ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniform float in [0, 1). */
export function random(r: RngHolder): number {
  r.rng = (r.rng + 0x6d2b79f5) | 0;
  let t = r.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform float in [min, max). */
export function range(r: RngHolder, min: number, max: number): number {
  return min + (max - min) * random(r);
}

/** Uniform integer in [min, max] (inclusive). */
export function int(r: RngHolder, min: number, max: number): number {
  return min + Math.floor(random(r) * (max - min + 1));
}

/** Picks an item by weight. `items` must be non-empty. */
export function weighted<T>(
  r: RngHolder,
  items: readonly T[],
  weightOf: (item: T) => number,
): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weightOf(item));
  let roll = random(r) * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll < 0) return item;
  }
  const last = items[items.length - 1];
  if (last === undefined) throw new Error("weighted() needs at least one item");
  return last;
}
