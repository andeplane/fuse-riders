import type { PickupType } from './game.js';
/** Every ordinary drop is three times as likely as the rare five-bomb fan. */
export const PICKUP_WEIGHTS: ReadonlyArray<Readonly<{ type: PickupType; weight: number }>> = [
  { type: 'blast', weight: 3 }, { type: 'star', weight: 3 }, { type: 'beer', weight: 3 }, { type: 'ink', weight: 3 },
  { type: 'triple', weight: 3 }, { type: 'five', weight: 1 }, { type: 'target', weight: 1 },
  { type: 'orbitShield', weight: 3 }, { type: 'portal', weight: 3 },
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
