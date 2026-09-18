import type { GameState, PlayerState } from "../state.js";
import type { Movement } from "./context.js";
import {
  type ObstacleHitbox,
  edgesOpen,
  hitboxBounceNormal,
} from "../arena-map.js";
import { atan2, cos, sin } from "../deterministic-math.js";
import { normalizeAngle } from "../geometry.js";
import { wallReach } from "./field.js";
import { detachTrail } from "../trail-lifecycle.js";
/** What a rider is proof against this tick, and how a wall or a piece of scenery turns one back. */

export function isInvulnerable(player: PlayerState, tick: number): boolean {
  return player.invulnerableUntilTick > tick;
}

export function isHazardImmune(player: PlayerState, tick: number): boolean {
  return (
    isInvulnerable(player, tick) ||
    player.shieldGraceUntilTick > tick ||
    player.portalGraceUntilTick > tick
  );
}

export function reflectAtBoundary(
  state: GameState,
  movement: Movement,
): boolean {
  // An open edge is not a surface: the rider carries on through it.
  if (edgesOpen(state)) return false;
  const reach = wallReach(state);
  const left = state.boundaryInset + reach;
  const right = state.width - state.boundaryInset - reach;
  const top = state.boundaryInset + reach;
  const bottom = state.height - state.boundaryInset - reach;
  const hitX = movement.x < left || movement.x > right;
  const hitY = movement.y < top || movement.y > bottom;
  if (!hitX && !hitY) return false;
  movement.x = Math.max(left, Math.min(right, movement.x));
  movement.y = Math.max(top, Math.min(bottom, movement.y));
  if (hitX) {
    movement.angle = normalizeAngle(Math.PI - movement.angle);
    movement.player.drunkHeadingOffset *= -1;
  }
  if (hitY) {
    movement.angle = normalizeAngle(-movement.angle);
    movement.player.drunkHeadingOffset *= -1;
  }
  return true;
}

/**
 * An absorbed crash leaves the rider against the face it hit, turned away from it: the same deal the boundary gives a
 * shielded rider, and without it a shield would only buy the ticks of grace it takes to die inside the same obstacle.
 */
export function reflectAtObstacle(
  hit: ObstacleHitbox,
  movement: Movement,
  contactTime: number,
): boolean {
  movement.x = movement.oldX + (movement.x - movement.oldX) * contactTime;
  movement.y = movement.oldY + (movement.y - movement.oldY) * contactTime;
  const { nx, ny } = hitboxBounceNormal(hit, movement.x, movement.y);
  const heading = { x: cos(movement.angle), y: sin(movement.angle) };
  const approach = heading.x * nx + heading.y * ny;
  if (approach >= 0) return false; // already turned away from the face by this tick's steering
  movement.angle = normalizeAngle(
    atan2(heading.y - 2 * approach * ny, heading.x - 2 * approach * nx),
  );
  movement.player.drunkHeadingOffset *= -1;
  return true;
}

/**
 * A rider leaves the round, by dying or by being eliminated from outside the tick: no longer alive, no charge held,
 * its trail detached into debris that decays on its own clock, and the tick stamped for the round's ranking.
 */
export function takeOutOfRound(state: GameState, player: PlayerState): void {
  player.alive = false;
  player.bombChargeStartedTick = undefined;
  player.gunAim = undefined;
  player.trail = detachTrail(
    player.trail,
    state.tick,
    () => state.nextTrailPieceId++,
  );
  const participant = state.roundParticipants.get(player.id);
  if (participant && participant.eliminatedAtTick === undefined)
    participant.eliminatedAtTick = state.tick;
}
