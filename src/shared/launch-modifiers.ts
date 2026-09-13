export const TRIPLE_SHOT_ANGLES = [-0.22, 0, 0.22] as const;
export const HOMING_TURN_CAP_RADIANS = 0.12;
export const HOMING_FLIGHT_STEPS = 6;

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

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function clampAngle(angle: number, center: number, limit: number): number {
  return center + clamp(angleDelta(center, angle), -limit, limit);
}

export function volleyAngles(baseAngle: number): number[] {
  if (!Number.isFinite(baseAngle)) throw new RangeError('baseAngle must be finite');
  return TRIPLE_SHOT_ANGLES.map(offset => baseAngle + offset);
}

/** Precomputes launch plus six flight positions toward one fixed target. */
export function createHomingFlightPath(
  start: Readonly<Pick<FlightPoint, 'x' | 'y' | 'angle'>>,
  target: Readonly<Pick<FlightPoint, 'x' | 'y'>>,
  distance: number,
  bounds: LaunchBounds,
  turnCap = HOMING_TURN_CAP_RADIANS,
): FlightPoint[] {
  if (![start.x, start.y, start.angle, target.x, target.y, distance, turnCap, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) || distance < 0 || turnCap < 0) {
    throw new RangeError('invalid homing flight inputs');
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new RangeError('invalid launch bounds');
  const path: FlightPoint[] = [{ x: clamp(start.x, bounds.minX, bounds.maxX), y: clamp(start.y, bounds.minY, bounds.maxY), angle: start.angle }];
  const stepDistance = distance / HOMING_FLIGHT_STEPS;
  for (let step = 0; step < HOMING_FLIGHT_STEPS; step += 1) {
    const current = path[path.length - 1]!;
    const desired = Math.atan2(target.y - current.y, target.x - current.x);
    const angle = clampAngle(desired, current.angle, turnCap);
    path.push({
      x: clamp(current.x + Math.cos(angle) * stepDistance, bounds.minX, bounds.maxX),
      y: clamp(current.y + Math.sin(angle) * stepDistance, bounds.minY, bounds.maxY),
      angle,
    });
  }
  return path;
}

export function createVolleyFlightPaths(
  start: Readonly<Pick<FlightPoint, 'x' | 'y'>>,
  baseAngle: number,
  distance: number,
  bounds: LaunchBounds,
  target?: Readonly<Pick<FlightPoint, 'x' | 'y'>>,
): FlightPoint[][] {
  return volleyAngles(baseAngle).map(angle => target
    ? createHomingFlightPath({ ...start, angle }, target, distance, bounds)
    : Array.from({ length: HOMING_FLIGHT_STEPS + 1 }, (_, step) => ({
      x: clamp(start.x + Math.cos(angle) * distance * step / HOMING_FLIGHT_STEPS, bounds.minX, bounds.maxX),
      y: clamp(start.y + Math.sin(angle) * distance * step / HOMING_FLIGHT_STEPS, bounds.minY, bounds.maxY),
      angle,
    })));
}
