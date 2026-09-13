import type { PickupType } from './game.js';
/** Target is about half its previous probability; other relative ratios are preserved. */
export const PICKUP_WEIGHTS: ReadonlyArray<Readonly<{ type: PickupType; weight: number }>> = [
  { type: 'gun', weight: 2250 }, { type: 'shell', weight: 533 }, { type: 'blast', weight: 6396 }, { type: 'beer', weight: 1599 }, { type: 'ink', weight: 1599 },
  { type: 'triple', weight: 5535 }, { type: 'five', weight: 1845 }, { type: 'target', weight: 1650 },
  { type: 'stopwatch', weight: 1599 }, { type: 'orbitShield', weight: 1599 }, { type: 'portal', weight: 1599 },
];
export function pickupTypeForRoll(roll: number): PickupType {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('roll must be in [0, 1)');
  const total = PICKUP_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let remaining = roll * total;
  for (const entry of PICKUP_WEIGHTS) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.type;
  }
  return PICKUP_WEIGHTS[PICKUP_WEIGHTS.length - 1]!.type;
}
