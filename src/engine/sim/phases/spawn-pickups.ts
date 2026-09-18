import type { TickContext } from "../context.js";
import { type GameState, sortedBombs, sortedPlayers } from "../../state.js";
import {
  PICKUP_OBSTACLE_CLEARANCE,
  PICKUP_RADIUS,
  PICKUP_RIDER_BOMB_CLEARANCE,
  PICKUP_SEPARATION,
  PICKUP_SPAWN_ATTEMPTS,
  PICKUP_SPAWN_MARGIN,
  PICKUP_TRAIL_CLEARANCE,
} from "../../tuning.js";
import { nextRandom } from "../../rng.js";
import { obstacleTouchesCircle } from "../../arena-map.js";
import { pointSegmentDistanceSquared, square } from "../../geometry.js";
import { roomPickup } from "../../room-settings.js";

/**
 * On the pacing interval, one pickup of a rolled type is placed somewhere safe, while the board is under its cap.
 */
export function spawnPickups(ctx: TickContext): void {
  const { state, pickupSchedule } = ctx;
  if (state.tick >= state.nextPickupSpawnTick) {
    state.nextPickupSpawnTick = state.tick + pickupSchedule.interval;
    maybeSpawnPickup(state, pickupSchedule.cap);
  }
}

function maybeSpawnPickup(state: GameState, cap: number): void {
  if (state.pickups.length >= cap) return;
  const typeRoll = nextRandom(state);
  const type = roomPickup(typeRoll, state.settings.weights);
  if (!type) return;
  const minimumX = state.boundaryInset + PICKUP_SPAWN_MARGIN;
  const maximumX = state.width - state.boundaryInset - PICKUP_SPAWN_MARGIN;
  const minimumY = state.boundaryInset + PICKUP_SPAWN_MARGIN;
  const maximumY = state.height - state.boundaryInset - PICKUP_SPAWN_MARGIN;
  if (minimumX >= maximumX || minimumY >= maximumY) return;

  for (let attempt = 0; attempt < PICKUP_SPAWN_ATTEMPTS; attempt += 1) {
    const x = minimumX + nextRandom(state) * (maximumX - minimumX);
    const y = minimumY + nextRandom(state) * (maximumY - minimumY);
    if (!isSafePickupPosition(state, x, y)) continue;
    state.pickups.push({
      id: state.nextPickupId++,
      type,
      x,
      y,
      expiresAtTick: Number.MAX_SAFE_INTEGER,
    });
    return;
  }
}

function isSafePickupPosition(state: GameState, x: number, y: number): boolean {
  for (const player of sortedPlayers(state)) {
    if (
      player.alive &&
      square(player.x - x) + square(player.y - y) <
        square(PICKUP_RIDER_BOMB_CLEARANCE)
    )
      return false;
    for (const trail of player.trail) {
      if (
        pointSegmentDistanceSquared(
          x,
          y,
          trail.x1,
          trail.y1,
          trail.x2,
          trail.y2,
        ) < square(PICKUP_TRAIL_CLEARANCE)
      )
        return false;
    }
  }
  for (const bomb of sortedBombs(state)) {
    if (bomb.shell?.gun) continue;
    if (
      square(bomb.x - x) + square(bomb.y - y) <
      square(PICKUP_RIDER_BOMB_CLEARANCE)
    )
      return false;
  }
  if (
    state.obstacles.some((obstacle) =>
      obstacleTouchesCircle(
        obstacle,
        x,
        y,
        PICKUP_RADIUS + PICKUP_OBSTACLE_CLEARANCE,
      ),
    )
  )
    return false;
  return state.pickups.every(
    (pickup) =>
      square(pickup.x - x) + square(pickup.y - y) >= square(PICKUP_SEPARATION),
  );
}
