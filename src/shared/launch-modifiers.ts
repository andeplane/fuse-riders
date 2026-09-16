import { sin, cos } from './deterministic-math.js';
export const FIVE_SHOT_ANGLES = [-0.44, -0.22, 0, 0.22, 0.44] as const;
export const TRIPLE_SHOT_ANGLES = [-0.22, 0, 0.22] as const;
/** Round upgrade stops at nine ordinary bombs; Five can add four temporary bombs. */
export const MAX_EXTRA_BOMBS = 8;
export const MAX_VOLLEY_BOMBS = 1 + MAX_EXTRA_BOMBS + 4;
export function bombsPerShot(player: { extraBombs: number; tripleShotArmed: boolean; fiveShotArmed: boolean }): number {
  return 1 + player.extraBombs + (player.fiveShotArmed ? 4 : player.tripleShotArmed ? 2 : 0);
}
export const VOLLEY_FLIGHT_STEPS = 6;

export interface LaunchBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface FlightPoint {
  x: number;
  y: number;
  angle: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function volleyAngles(baseAngle: number, count: number = 3): number[] {
  if (!Number.isFinite(baseAngle)) throw new RangeError('baseAngle must be finite');
  if (!Number.isInteger(count) || count < 1 || count > MAX_VOLLEY_BOMBS) throw new RangeError('invalid volley count');
  // Preserve the existing 3/5 fans; larger volleys pack evenly into the same forward cone.
  const spacing = count <= 5 ? .22 : .88 / (count - 1);
  return Array.from({ length: count }, (_, index) => baseAngle + (index - (count - 1) / 2) * spacing);
}

export function createVolleyFlightPaths(
  start: Readonly<Pick<FlightPoint, 'x' | 'y'>>,
  baseAngle: number,
  distance: number,
  bounds: LaunchBounds,
  count: number = 3,
): FlightPoint[][] {
  if (![start.x, start.y, distance, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) || distance < 0) throw new RangeError('invalid volley flight inputs');
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new RangeError('invalid launch bounds');
  return volleyAngles(baseAngle, count).map(angle => Array.from({ length: VOLLEY_FLIGHT_STEPS + 1 }, (_, step) => ({
      x: clamp(start.x + cos(angle) * distance * step / VOLLEY_FLIGHT_STEPS, bounds.minX, bounds.maxX),
      y: clamp(start.y + sin(angle) * distance * step / VOLLEY_FLIGHT_STEPS, bounds.minY, bounds.maxY),
      angle,
    })));
}
