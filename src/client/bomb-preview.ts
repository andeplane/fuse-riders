import {
  BOMB_MAX_CHARGE_TICKS,
  bombAimDistance,
} from "../engine/bomb-launch.js";

/** Sample the shared curve each frame; actual releases still use whole ticks. */
export function bombPreviewDistance(
  chargeTicks: number,
  maxChargeTicks = BOMB_MAX_CHARGE_TICKS,
  bounce = false,
  rangeLevel = 0,
): number {
  return bombAimDistance(chargeTicks, maxChargeTicks, bounce, rangeLevel);
}
