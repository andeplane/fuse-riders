import { bombAimDistance } from "../engine/view-kit.js";

/**
 * Sample the shared curve each frame; actual releases still use whole ticks.
 * `maxChargeTicks`, `bounce` and `rangeLevel` are the view's `bombChargeTicks`, `aimBounce` and the rider's `rangeLevel`.
 */
export function bombPreviewDistance(
  chargeTicks: number,
  maxChargeTicks: number,
  bounce = false,
  rangeLevel = 0,
): number {
  return bombAimDistance(chargeTicks, maxChargeTicks, bounce, rangeLevel);
}
