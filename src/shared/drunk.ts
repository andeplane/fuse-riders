import { sin } from './deterministic-math.js';
export const DRUNK_DURATION_TICKS = 80;
export const DRUNK_CYCLE_TICKS = 40;
export const DRUNK_FADE_TICKS = 10;
export const DRUNK_MAX_HEADING_OFFSET = Math.PI / 12;

function phaseFor(seed: number, playerId: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = Math.imul(hash ^ playerId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash / 0xffffffff * Math.PI * 2;
}

function smoothstep(value: number): number { return value * value * (3 - 2 * value); }

/** An absolute heading offset, never angular velocity: integrate differences only. */
export function drunkHeadingOffset(seed: number, playerId: string, tick: number, startedTick: number, untilTick: number): number {
  if (![tick, startedTick, untilTick].every(Number.isFinite) || tick <= startedTick || tick >= untilTick) return 0;
  const age = tick - startedTick;
  const fade = smoothstep(Math.min(1, age / DRUNK_FADE_TICKS, (untilTick - tick) / DRUNK_FADE_TICKS));
  return DRUNK_MAX_HEADING_OFFSET * fade * sin(age * Math.PI * 2 / DRUNK_CYCLE_TICKS + phaseFor(seed, playerId));
}
