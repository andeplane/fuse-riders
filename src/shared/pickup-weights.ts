import type { PickupType } from './game.js';
/** Scale volleys by 45 and other drops by 26: exactly 1.5x previous volley probability after normalization. */
export const PICKUP_WEIGHTS: ReadonlyArray<Readonly<{ type: PickupType; weight: number }>> = [
  { type: 'shell', weight: 1 * 26 }, { type: 'blast', weight: 12 * 26 }, { type: 'star', weight: 3 * 26 }, { type: 'beer', weight: 3 * 26 }, { type: 'ink', weight: 3 * 26 },
  { type: 'triple', weight: 6 * 45 }, { type: 'five', weight: 2 * 45 }, { type: 'target', weight: 2 * 26 },
  { type: 'orbitShield', weight: 3 * 26 }, { type: 'portal', weight: 3 * 26 },
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
