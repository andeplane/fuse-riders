import type { Arena, Keeper } from "./arena.js";
import { S, HALF, BODY, readyHook } from "./world.js";
import type { MapId } from "./maps.js";

export const POWER_COOLDOWN = 600;
export const WARD_TICKS = 300;
export const POWER_PADS: Record<
  MapId,
  readonly { kind: "lift" | "ward"; x: number; y: number }[]
> = {
  belfry: [
    { kind: "lift", x: 490, y: 782 },
    { kind: "ward", x: 130, y: 782 },
  ],
  crossroads: [
    { kind: "lift", x: 460, y: 632 },
    { kind: "ward", x: 1140, y: 632 },
  ],
};
export interface PickupEvent {
  tick: number;
  by: string;
  pad: number;
}
/** Post-movement contact: earlier rival hits stand, and new Ward protects from next tick. */
export function stepPowerUps(
  arena: Arena,
  eligible: (keeper: Keeper) => boolean,
): void {
  if (arena.tuning.powerUps !== "on") return;
  const acquired: PickupEvent[] = [];
  for (const [index, pad] of POWER_PADS[arena.tuning.map].entries()) {
    arena.powerCooldowns[index] = Math.max(0, arena.powerCooldowns[index]! - 1);
    if (arena.powerCooldowns[index]) continue;
    const keeper = arena.keepers.find(
      (k) =>
        eligible(k) &&
        !k.world.respawn &&
        Math.abs(k.world.x - pad.x * S) <= HALF + 14 * S &&
        k.world.feet >= (pad.y - 14) * S &&
        k.world.feet - BODY <= (pad.y + 14) * S,
    );
    if (!keeper) continue;
    arena.powerCooldowns[index] = POWER_COOLDOWN;
    acquired.push({ tick: arena.tick, by: keeper.id, pad: index });
    if (pad.kind === "ward") keeper.ward = WARD_TICKS;
    else {
      const world = keeper.world;
      world.vy = -16 * S;
      world.grounded = false;
      world.coyote = world.buffer = 0;
      world.hook = readyHook();
      // Preserve the existing air-jump reserve; power-ups never refill it.
    }
  }
  if (acquired.length) arena.pickupEvents = acquired;
}
