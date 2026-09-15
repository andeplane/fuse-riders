import { BOMB_MAX_CHARGE_TICKS, bombLaunchDistance } from '../shared/bomb-launch.js';

/** Interpolate the authoritative distances for display; actual releases still use whole ticks. */
export function bombPreviewDistance(chargeTicks: number, maxChargeTicks = BOMB_MAX_CHARGE_TICKS): number {
  const age = Number.isFinite(chargeTicks) ? Math.max(0, Math.min(maxChargeTicks, chargeTicks)) : 0;
  const whole = Math.floor(age);
  const start = bombLaunchDistance(whole, maxChargeTicks);
  return start + (bombLaunchDistance(whole + 1, maxChargeTicks) - start) * (age - whole);
}
