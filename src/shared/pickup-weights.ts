import type { PickupType } from './game.js';
import { POWER_TUNING } from './power-progression.js';
/** Power supplies roughly four fifths of default drops; specials stay occasional. */
export const PICKUP_WEIGHTS: ReadonlyArray<Readonly<{ type: PickupType; weight: number }>> = [
  { type: 'power', weight: POWER_TUNING.defaultDropWeight },
  { type: 'extraBomb', weight: 100 }, { type: 'stopwatch', weight: 160 },
  { type: 'gun', weight: 225 }, { type: 'shell', weight: 53 }, { type: 'beer', weight: 160 }, { type: 'ink', weight: 160 },
  { type: 'triple', weight: 540 }, { type: 'five', weight: 180 }, { type: 'target', weight: 165 },
  { type: 'orbitShield', weight: 160 }, { type: 'boost', weight: 160 }, { type: 'gravity', weight: 120 }, { type: 'grip', weight: 160 }, { type: 'portal', weight: 160 },
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
