/** A random source in [0, 1). Production seeds one from the clock; tests seed their own, so a run replays. */
export type Random = () => number;

/** Mulberry32: small, fast and good enough for fake hubs. The same seed always gives the same sequence. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** An integer in [min, max], both ends included. */
export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One element of a non-empty list. */
export function pick<T>(random: Random, items: readonly [T, ...T[]]): T {
  return items[Math.floor(random() * items.length)] ?? items[0];
}
