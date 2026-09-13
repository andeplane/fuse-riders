export const TRIPLE_SHOT_ANGLES = [-0.22, 0, 0.22] as const;
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

export function volleyAngles(baseAngle: number): number[] {
  if (!Number.isFinite(baseAngle)) throw new RangeError('baseAngle must be finite');
  return TRIPLE_SHOT_ANGLES.map(offset => baseAngle + offset);
}

export function createVolleyFlightPaths(
  start: Readonly<Pick<FlightPoint, 'x' | 'y'>>,
  baseAngle: number,
  distance: number,
  bounds: LaunchBounds,
): FlightPoint[][] {
  if (![start.x, start.y, distance, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) || distance < 0) throw new RangeError('invalid volley flight inputs');
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new RangeError('invalid launch bounds');
  return volleyAngles(baseAngle).map(angle => Array.from({ length: VOLLEY_FLIGHT_STEPS + 1 }, (_, step) => ({
      x: clamp(start.x + Math.cos(angle) * distance * step / VOLLEY_FLIGHT_STEPS, bounds.minX, bounds.maxX),
      y: clamp(start.y + Math.sin(angle) * distance * step / VOLLEY_FLIGHT_STEPS, bounds.minY, bounds.maxY),
      angle,
    })));
}
