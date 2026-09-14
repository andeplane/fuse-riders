import { BOMB_MAX_CHARGE_TICKS, bombLaunchDistance } from '../shared/bomb-launch.js';

/** Interpolate the authoritative distances for display; actual releases still use whole ticks. */
export function bombPreviewDistance(chargeTicks: number): number {
  const age = Number.isFinite(chargeTicks) ? Math.max(0, Math.min(BOMB_MAX_CHARGE_TICKS, chargeTicks)) : 0;
  const whole = Math.floor(age);
  const start = bombLaunchDistance(whole);
  return start + (bombLaunchDistance(whole + 1) - start) * (age - whole);
}
