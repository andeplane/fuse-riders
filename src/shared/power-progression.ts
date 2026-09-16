/** First-pass balance for #201. Tick values use the simulation's 20 Hz clock.
 * Tune abundance independently of progression: interval/per-rider cap control how
 * much is on the board; pickupsPerLevel controls how quickly a rider grows.
 */
export const POWER_TUNING = {
  pickupsPerLevel: 5,
  defaultDropWeight: 8000,
  // One drop every two seconds per living rider, interleaved into one schedule.
  spawnTicksPerRider: 40,
  activePickupsPerRider: 4,
  maxActivePickups: 20,
  baseBlastRadius: 90,
  maxBlastRadius: 180,
  baseReloadTicks: 80,
  // Ordinary bombs block another launch until their 40-tick fuse ends.
  minReloadTicks: 45,
  halfStrengthLevel: 6,
} as const;

/** Defensive serialization bound, far beyond what can be collected in a round. */
export const MAX_POWER_PICKUPS = 1_000_000;
export const MAX_BOARD_PICKUPS = POWER_TUNING.maxActivePickups;
export function powerLevel(pickups: number): number {
  return Math.floor(pickups / POWER_TUNING.pickupsPerLevel);
}
export function powerProgress(pickups: number): number {
  return pickups % POWER_TUNING.pickupsPerLevel;
}
/** Rational diminishing returns: six earned upgrades receive half of the available improvement. */
function strength(pickups: number): number {
  const level = powerLevel(pickups);
  return level / (level + POWER_TUNING.halfStrengthLevel);
}
export function powerBlastRadius(pickups: number): number {
  return POWER_TUNING.baseBlastRadius + (POWER_TUNING.maxBlastRadius - POWER_TUNING.baseBlastRadius) * strength(pickups);
}
export function powerReloadTicks(pickups: number): number {
  return Math.round(POWER_TUNING.baseReloadTicks - (POWER_TUNING.baseReloadTicks - POWER_TUNING.minReloadTicks) * strength(pickups));
}
/** No elapsed-time ramp. Human and AI riders count equally; waiting/dead seats do not. */
export function pickupPacing(livingRiders: number): { interval: number; cap: number } {
  return {
    interval: Math.max(1, Math.round(POWER_TUNING.spawnTicksPerRider / Math.max(1, livingRiders))),
    cap: Math.min(MAX_BOARD_PICKUPS, livingRiders * POWER_TUNING.activePickupsPerRider),
  };
}
