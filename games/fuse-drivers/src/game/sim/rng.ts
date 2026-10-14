/** mulberry32 as a pure function. State is a uint32 stored on the race snapshot (ADR 002). */
export function nextRandom(state: number): [value: number, state: number] {
  let a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}
