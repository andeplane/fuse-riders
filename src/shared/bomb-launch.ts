import { sin, cos } from './deterministic-math.js';
export const BOMB_MIN_LAUNCH_DISTANCE = 100;
export const BOMB_MAX_LAUNCH_DISTANCE = 400;
export const BOMB_MAX_CHARGE_TICKS = 24;
export const BOMB_FLIGHT_TICKS = 6;

export interface LandingBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function bombLaunchDistance(chargeTicks: number): number {
  const ticks = Number.isFinite(chargeTicks) ? Math.max(0, Math.min(BOMB_MAX_CHARGE_TICKS, Math.floor(chargeTicks))) : 0;
  return BOMB_MIN_LAUNCH_DISTANCE +
    (BOMB_MAX_LAUNCH_DISTANCE - BOMB_MIN_LAUNCH_DISTANCE) * ticks / BOMB_MAX_CHARGE_TICKS;
}

export function bombLandingPoint(
  x: number,
  y: number,
  angle: number,
  distance: number,
  bounds: LandingBounds,
): { x: number; y: number } {
  return {
    x: Math.max(bounds.left, Math.min(bounds.right, x + cos(angle) * distance)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, y + sin(angle) * distance)),
  };
}
