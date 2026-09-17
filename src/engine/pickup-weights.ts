import type { PickupType } from "./pickup-types.js";
import { POWER_TUNING } from "./power-progression.js";
/**
 * Power supplies roughly three quarters of default drops; specials stay occasional. These are the weights of
 * `defaultRoomSettings()`; the one draw that reads weights is `roomPickup`, over the game's settings.
 */
export const PICKUP_WEIGHTS: ReadonlyArray<
  Readonly<{ type: PickupType; weight: number }>
> = [
  { type: "power", weight: POWER_TUNING.defaultDropWeight },
  { type: "extraBomb", weight: 400 },
  { type: "stopwatch", weight: 160 },
  { type: "gun", weight: 225 },
  { type: "shell", weight: 53 },
  { type: "target", weight: 165 },
  { type: "beer", weight: 160 },
  { type: "ink", weight: 160 },
  { type: "triple", weight: 540 },
  { type: "five", weight: 180 },
  { type: "orbitShield", weight: 160 },
  { type: "portal", weight: 160 },
  { type: "gravity", weight: 120 },
  { type: "grip", weight: 160 },
  { type: "nitro", weight: 160 },
  { type: "snail", weight: 160 },
];
