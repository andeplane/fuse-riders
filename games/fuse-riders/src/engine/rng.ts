/** The seeded random stream every replica shares. The stream's position lives in `GameState.randomState`. */

export function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return normalizeSeed(hash);
}

export function normalizeSeed(seed: number): number {
  const normalized = Number.isFinite(seed) ? seed >>> 0 : 0;
  return normalized || 0x6d2b79f5;
}

/** One draw from the stream carried in the state, so a restored or re-simulated world draws the same numbers. */
export function nextRandom(state: { randomState: number }): number {
  state.randomState = (state.randomState + 0x6d2b79f5) >>> 0;
  let value = state.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
