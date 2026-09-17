import { sin, cos } from "./deterministic-math.js";
export const BOMB_MIN_LAUNCH_DISTANCE = 100;
export const BOMB_MAX_LAUNCH_DISTANCE = 400;
export const BOMB_MAX_CHARGE_TICKS = 8; // Full reach in 0.4 seconds at 20 Hz.
export const BOMB_MIN_CHARGE_TICKS = 2;
export const BOMB_CHARGE_TICKS_LIMIT = 40;
export const BOMB_FLIGHT_TICKS = 6;

export function isBombChargeTicks(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= BOMB_MIN_CHARGE_TICKS &&
    value <= BOMB_CHARGE_TICKS_LIMIT
  );
}

export interface LandingBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where a charge of `ticks` sits on the ramp, in [0, maxChargeTicks].
 * Without bounce the ramp stops at the top. With it, holding on walks the range back down to the minimum and up again,
 * so the same hold keeps offering every distance instead of parking at maximum. One definition, so the simulation and
 * the on-screen preview cannot disagree about where a bomb will land (#166).
 */
export function chargeRamp(
  ticks: number,
  maxChargeTicks: number,
  bounce: boolean,
): number {
  const held = Number.isFinite(ticks) ? Math.max(0, Math.floor(ticks)) : 0;
  if (!bounce) return Math.min(maxChargeTicks, held);
  const period = maxChargeTicks * 2;
  const phase = held % period;
  return phase <= maxChargeTicks ? phase : period - phase;
}

export function bombLaunchDistance(
  chargeTicks: number,
  maxChargeTicks = BOMB_MAX_CHARGE_TICKS,
  bounce = false,
): number {
  return (
    BOMB_MIN_LAUNCH_DISTANCE +
    ((BOMB_MAX_LAUNCH_DISTANCE - BOMB_MIN_LAUNCH_DISTANCE) *
      chargeRamp(chargeTicks, maxChargeTicks, bounce)) /
      maxChargeTicks
  );
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
