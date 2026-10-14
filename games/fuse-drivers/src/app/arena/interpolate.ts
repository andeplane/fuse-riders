import type { RaceState } from "../../game/sim/race.js";
import { lerp, wrapAngle, type Truck } from "../../game/sim/truck.js";

export interface TruckPose {
  x: number;
  y: number;
  heading: number;
}

/** Further than a truck can travel in one tick, so a respawn or a teleport is never smeared across the map. */
const SNAP_DISTANCE = 200;

/**
 * Positions lerp, headings lerp by the shortest arc, respawns and teleports snap. The rule the game has
 * always drawn by; a rollback that rewrote the truck's place lands as a jump larger than `SNAP_DISTANCE`
 * and snaps rather than sliding the truck across the track.
 */
export function renderTruck(
  prev: Truck | undefined,
  next: Truck,
  nextTick: number,
  alpha: number,
): TruckPose {
  if (
    !prev ||
    next.respawnedTick === nextTick ||
    Math.hypot(next.x - prev.x, next.y - prev.y) > SNAP_DISTANCE
  )
    return { x: next.x, y: next.y, heading: next.heading };
  return {
    x: lerp(prev.x, next.x, alpha),
    y: lerp(prev.y, next.y, alpha),
    heading: wrapAngle(
      prev.heading + wrapAngle(next.heading - prev.heading) * alpha,
    ),
  };
}

/** Every truck of the newer state, posed between the two states. */
export function renderSnapshot(
  prev: RaceState | undefined,
  next: RaceState,
  alpha: number,
): TruckPose[] {
  return next.trucks.map((truck, slot) =>
    renderTruck(prev?.trucks[slot], truck, next.tick, alpha),
  );
}
