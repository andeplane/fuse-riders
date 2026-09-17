/** First-pass balance for #201. Tick values use the simulation's 20 Hz clock.
 * Tune abundance independently of progression: interval/per-rider cap control how
 * much is on the board; halfStrengthPickups controls weapon improvement, while
 * trailTicksPerPickup controls linear trail growth.
 */
export const POWER_TUNING = {
  defaultDropWeight: 8000,
  // One drop every two seconds per living rider, interleaved into one schedule.
  spawnTicksPerRider: 40,
  activePickupsPerRider: 4,
  maxActivePickups: 20,
  baseBlastRadius: 90,
  maxBlastRadius: 180,
  // Ready again when the default 40-tick fuse ends; live volleys still block firing.
  baseReloadTicks: 40,
  minReloadTicks: 20,
  halfStrengthPickups: 30,
  baseTrailLifetimeTicks: 160,
  trailTicksPerPickup: 40,
  // Resource ceiling: at most one new segment per rider per tick.
  maxTrailLifetimeTicks: 1024,
} as const;

/** Defensive serialization bound, far beyond what can be collected in a round. */
export const MAX_POWER_PICKUPS = 1_000_000;
export const MAX_BOARD_PICKUPS = POWER_TUNING.maxActivePickups;
/** Every pickup contributes, with half the available improvement at the configured count. */
function strength(pickups: number): number {
  return pickups / (pickups + POWER_TUNING.halfStrengthPickups);
}
export function powerBlastRadius(pickups: number): number {
  return (
    POWER_TUNING.baseBlastRadius +
    (POWER_TUNING.maxBlastRadius - POWER_TUNING.baseBlastRadius) *
      strength(pickups)
  );
}
export function powerReloadTicks(pickups: number): number {
  return Math.round(
    POWER_TUNING.baseReloadTicks -
      (POWER_TUNING.baseReloadTicks - POWER_TUNING.minReloadTicks) *
        strength(pickups),
  );
}
/** Linear trail growth, capped only by the shared trail/checkpoint resource budget. */
export function powerTrailLifetimeTicks(pickups: number): number {
  return Math.min(
    POWER_TUNING.maxTrailLifetimeTicks,
    POWER_TUNING.baseTrailLifetimeTicks +
      pickups * POWER_TUNING.trailTicksPerPickup,
  );
}
/** No elapsed-time ramp. Human and AI riders count equally; waiting/dead seats do not. */
export function pickupPacing(livingRiders: number): {
  interval: number;
  cap: number;
} {
  return {
    interval: Math.max(
      1,
      Math.round(POWER_TUNING.spawnTicksPerRider / Math.max(1, livingRiders)),
    ),
    cap: Math.min(
      MAX_BOARD_PICKUPS,
      livingRiders * POWER_TUNING.activePickupsPerRider,
    ),
  };
}
