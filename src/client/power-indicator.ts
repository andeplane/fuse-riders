import { powerLevel, powerProgress, POWER_TUNING } from '../shared/power-progression.js';

export const POWER_RING_RADIUS = 13;
export const POWER_RING_COLOR = '#ffdf55';

/** Display starts at one; zero earned upgrades still has the base weapon stats. */
export function displayPowerLevel(pickups: number): number {
  return powerLevel(pickups) + 1;
}
/** Snapshot-derived progress fills clockwise and starts empty again at a level-up. */
export function powerRingProgress(pickups: number): number {
  return powerProgress(pickups) / POWER_TUNING.pickupsPerLevel;
}
