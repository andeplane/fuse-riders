/**
 * The world's randomness: a mulberry32 stream whose state the world carries (`World.rng`), so replay and rollback
 * draw the same numbers; and FNV-1a, how a match id becomes a seed and a world becomes a hash alike on every replica.
 */
import { imul } from "./math.js";

/** One mulberry32 step: the value and the next state. */
export function next(state: number): { value: number; state: number } {
  const advanced = (state + 0x6d2b79f5) >>> 0;
  let t = advanced;
  t = imul(t ^ (t >>> 15), t | 1);
  t ^= t + imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: advanced };
}

/** A whole number below `count` from a world's stream, which the draw advances. */
export function roll(world: { rng: number }, count: number): number {
  const draw = next(world.rng);
  world.rng = draw.state;
  return draw.value % count;
}

/** FNV-1a over a string's UTF-16 code units, as an unsigned 32-bit number. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    h = imul(h ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return h;
}

/** How a match id becomes a seed. */
export const seedOf = fnv1a;
