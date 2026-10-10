/**
 * The world's randomness: a mulberry32 stream whose state the world carries (`World.rng`), so replay and rollback
 * draw the same numbers; and `seedOf`, how a match id becomes a seed every replica derives alike.
 */

/** One mulberry32 step: the value and the next state. */
export function next(state: number): { value: number; state: number } {
  const advanced = (state + 0x6d2b79f5) >>> 0;
  let t = advanced;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: advanced };
}

/** FNV-1a over a string. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    h = Math.imul(h ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return h;
}
