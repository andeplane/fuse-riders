import { bombLaunchDistance } from "../engine/view-kit.js";

/**
 * Interpolate the authoritative distances for display; actual releases still use whole ticks.
 * `maxChargeTicks` and `bounce` are the view's `bombChargeTicks` and `aimBounce`.
 */
export function bombPreviewDistance(
  chargeTicks: number,
  maxChargeTicks: number,
  bounce = false,
): number {
  // Without bounce the ramp is clamped, so ages past the top interpolate between two identical distances and sit still.
  const age = Number.isFinite(chargeTicks)
    ? Math.max(0, bounce ? chargeTicks : Math.min(maxChargeTicks, chargeTicks))
    : 0;
  const whole = Math.floor(age);
  const start = bombLaunchDistance(whole, maxChargeTicks, bounce);
  return (
    start +
    (bombLaunchDistance(whole + 1, maxChargeTicks, bounce) - start) *
      (age - whole)
  );
}
