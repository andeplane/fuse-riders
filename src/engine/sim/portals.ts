import {
  type EliminationCause,
  type GameState,
  type PlayerId,
  sortedBombs,
  sortedPlayers,
} from "../state.js";
import type { Movement } from "./context.js";
import {
  PORTAL_WALL_HALF_WIDTH,
  type PortalPoint,
  type PortalTransit,
} from "../portal.js";
import { RIDER_RADIUS, TRAIL_WIDTH } from "../tuning.js";
import { hypot2 } from "../deterministic-math.js";
import { obstacleTouchesCircle } from "../arena-map.js";
import { pointSegmentDistanceSquared, square } from "../geometry.js";
import { segmentIntersectsDisk } from "../blast-geometry.js";
/** Where a gate may stand and where a crossing may come out: shared by pickup placement and every kind of transit. */

/**
 * Clearance from live portal walls, for two callers with different exemptions. Placement passes no
 * exemption, so a new pair is never laid over a running one. A transit exempts the pair being used,
 * whose own gate the exit deliberately hugs at PORTAL_WALL_HALF_WIDTH + RIDER_RADIUS + 1, and so
 * covers the foreign walls that placement clearance alone does not put out of an exit's reach.
 */
export function isClearOfPortalWalls(
  state: GameState,
  point: PortalPoint,
  radius: number,
  exemptPairId?: string,
): boolean {
  return state.portalPairs.every(
    (pair) =>
      pair.id === exemptPairId ||
      pair.gates.every(
        (gate) =>
          pointSegmentDistanceSquared(
            point.x,
            point.y,
            gate.x,
            gate.y - gate.halfLength,
            gate.x,
            gate.y + gate.halfLength,
          ) > square(radius + PORTAL_WALL_HALF_WIDTH),
      ),
  );
}

export function isSafePortalPosition(
  state: GameState,
  point: PortalPoint,
  radius: number,
  movements: ReadonlyMap<PlayerId, Movement>,
  ignoredPlayerId?: PlayerId,
  deaths: ReadonlyMap<PlayerId, EliminationCause> = new Map(),
  transits: ReadonlyMap<PlayerId, PortalTransit> = new Map(),
): boolean {
  for (const player of sortedPlayers(state)) {
    const movement = movements.get(player.id);
    const transit = transits.get(player.id);
    if (
      player.id !== ignoredPlayerId &&
      player.alive &&
      !deaths.has(player.id)
    ) {
      const position = transit?.exitPoint ?? movement ?? player;
      if (
        hypot2(position.x - point.x, position.y - point.y) <=
        radius + RIDER_RADIUS
      )
        return false;
    }
    for (const trail of player.trail) {
      if (
        pointSegmentDistanceSquared(
          point.x,
          point.y,
          trail.x1,
          trail.y1,
          trail.x2,
          trail.y2,
        ) <= square(radius + TRAIL_WIDTH / 2)
      )
        return false;
    }
    // Include this tick's pending trail, which has not yet been committed.
    if (
      movement &&
      !deaths.has(player.id) &&
      pointSegmentDistanceSquared(
        point.x,
        point.y,
        movement.oldX,
        movement.oldY,
        transit?.entryPoint.x ?? movement.x,
        transit?.entryPoint.y ?? movement.y,
      ) <= square(radius + TRAIL_WIDTH / 2)
    )
      return false;
  }
  // A gate laid across scenery, or an exit inside it, would drop a rider straight into a lethal wall.
  if (
    state.obstacles.some((obstacle) =>
      obstacleTouchesCircle(obstacle, point.x, point.y, radius),
    )
  )
    return false;
  // Reserve both current flight location and landing site of live projectiles.
  for (const bomb of sortedBombs(state)) {
    if (bomb.shell?.gun) continue;
    const flight =
      bomb.flightPath[
        Math.max(
          0,
          Math.min(bomb.flightPath.length - 1, state.tick - bomb.launchedTick),
        )
      ];
    if (
      hypot2(point.x - bomb.x, point.y - bomb.y) <= radius + 14 ||
      (flight && hypot2(point.x - flight.x, point.y - flight.y) <= radius + 14)
    )
      return false;
  }
  return !state.blasts.some((blast) =>
    segmentIntersectsDisk(
      point.x,
      point.y,
      point.x,
      point.y,
      blast.circle,
      radius,
    ),
  );
}
