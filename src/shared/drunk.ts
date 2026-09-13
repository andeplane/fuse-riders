export const DRUNK_DURATION_TICKS = 80;
export const DRUNK_KNOT_INTERVAL_TICKS = 10;
export const DRUNK_MAX_ANGULAR_VELOCITY = 2.0;

function fnv1aUtf16(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mix(seed: number, playerHash: number, knot: number): number {
  let value = (seed >>> 0) ^ playerHash;
  value = (value + Math.imul(knot | 0, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function signedValue(seed: number, playerHash: number, knot: number): number {
  return (mix(seed, playerHash, knot) / 0xffffffff) * 2 - 1;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

/** Deterministic, smooth angular-velocity perturbation in radians per second. */
export function drunkAngularVelocity(seed: number, playerId: string, tick: number): number {
  if (!Number.isFinite(tick)) return 0;
  const safeTick = Math.max(0, Math.floor(tick));
  const knot = Math.floor(safeTick / DRUNK_KNOT_INTERVAL_TICKS);
  const fraction = (safeTick % DRUNK_KNOT_INTERVAL_TICKS) / DRUNK_KNOT_INTERVAL_TICKS;
  const playerHash = fnv1aUtf16(playerId);
  const value = signedValue(seed, playerHash, knot) * (1 - smoothstep(fraction)) +
    signedValue(seed, playerHash, knot + 1) * smoothstep(fraction);
  return value * DRUNK_MAX_ANGULAR_VELOCITY;
}
