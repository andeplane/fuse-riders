import type { TickContext } from "../context.js";
import {
  EPSILON,
  firstContactTime,
  segmentDistanceSquared,
  square,
} from "../../geometry.js";
import { NO_WRAP } from "../../wrap.js";
import {
  RIDER_CONTACT_RADIUS,
  RIDER_OBSTACLE_RADIUS,
  RIDER_RADIUS,
  SELF_TRAIL_GRACE_TICKS,
  TRAIL_WIDTH,
  gravityCoreRadius,
} from "../../tuning.js";
import { hitboxBlocksPath, obstacleHitbox } from "../../arena-map.js";
import { isHazardImmune } from "../../effects.js";
import { markCause, markShot } from "../marks.js";
import { movementImages, wallReach } from "../field.js";
import { segmentIntersectsDisk } from "../../blast-geometry.js";
import { sortedObstacles, sortedPlayers } from "../../state.js";

/**
 * Each rider's step against everything that stands still: this tick's fuse blasts, the walls, a black hole's core,
 * scenery and every trail. Causes are marked and the moment of first contact kept; the winning cause is settled later,
 * so the order of these tests decides nothing but the order owners are listed in.
 */
export function detectHazards(ctx: TickContext): void {
  const {
    state,
    open,
    movements,
    causes,
    causeOwners,
    shotSources,
    trailContactTimes,
    obstacleContactTimes,
    obstaclesReached,
    trailHits,
    sceneryBefore,
  } = ctx;
  const newBlasts = ctx.fuseBlasts;
  // Id order: each contact bisection starts from the one before it, and the last to shorten it is what a shield
  // turns away from, so the order obstacles are visited in is part of the outcome.
  const obstacleHitboxes = sortedObstacles(state).map(obstacleHitbox);
  for (const movement of movements.values()) {
    // A rider overhanging an open edge, or whose step ends past it, is also in reach of a blast on the far side.
    for (const blast of newBlasts) {
      if (
        !isHazardImmune(movement.player, state.tick) &&
        (open ? movementImages(state, movement, RIDER_RADIUS) : NO_WRAP).some(
          ({ dx, dy }) =>
            segmentIntersectsDisk(
              movement.oldX + dx,
              movement.oldY + dy,
              movement.x + dx,
              movement.y + dy,
              blast.circle,
              RIDER_RADIUS,
            ),
        )
      ) {
        markCause(
          causes,
          causeOwners,
          movement.player.id,
          "explosion",
          blast.ownerId,
        );
        markShot(shotSources, movement.player.id, blast.bombId, blast.shot);
      }
    }

    const reach = wallReach(state);
    const left = state.boundaryInset + reach;
    const right = state.width - state.boundaryInset - reach;
    const top = state.boundaryInset + reach;
    const bottom = state.height - state.boundaryInset - reach;
    if (
      !open &&
      !isHazardImmune(movement.player, state.tick) &&
      (movement.x < left ||
        movement.x > right ||
        movement.y < top ||
        movement.y > bottom)
    ) {
      markCause(causes, causeOwners, movement.player.id, "wall");
    }
    // Falling into a black hole's core is the arena's kill, like the wall: nobody owns it.
    if (
      !isHazardImmune(movement.player, state.tick) &&
      state.gravityFields.some((field) =>
        segmentIntersectsDisk(
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
          { x: field.x, y: field.y, radius: gravityCoreRadius(field.radius) },
        ),
      )
    ) {
      markCause(causes, causeOwners, movement.player.id, "wall");
    }

    // Obstacles are solid the way the boundary is, and kill under the same cause. A hazard-immune rider passes
    // through untouched rather than bouncing: there is a far side to arrive at, unlike the arena wall.
    // Only the contact time is recorded here; the cause is decided below, once the trail and rider contacts of
    // this tick are known and can be compared against it.
    // A step that reaches past an open edge also meets the scenery just beyond it, which the state holds on the far
    // side: each piece is tested where the step's own frame puts it, and that image is what a shield turns away from.
    const sceneryImages = open
      ? movementImages(state, movement, RIDER_OBSTACLE_RADIUS)
      : NO_WRAP;
    for (const obstacle of obstacleHitboxes) {
      if (isHazardImmune(movement.player, state.tick)) break;
      for (const { dx, dy } of sceneryImages) {
        const piece =
          dx === 0 && dy === 0
            ? obstacle
            : { ...obstacle, x: obstacle.x - dx, y: obstacle.y - dy };
        const touches = (time: number): boolean =>
          hitboxBlocksPath(
            piece,
            movement.oldX,
            movement.oldY,
            movement.oldX + (movement.x - movement.oldX) * time,
            movement.oldY + (movement.y - movement.oldY) * time,
            RIDER_OBSTACLE_RADIUS,
          );
        const previous = obstacleContactTimes.get(movement.player.id) ?? 1;
        // Only immunity — a Star, shield grace, portal grace — can carry a rider into scenery, and it can lapse in
        // there. A rider that starts its step already overlapping an obstacle is let out of that one rather than
        // killed on the spot by a rock it had every right to be inside; any other obstacle is as solid as ever.
        // Scenery that moved this tick is judged where it stood before its step: a train that has just rolled onto
        // where the rider stands is not something the rider was ever inside of.
        const before = sceneryBefore.get(obstacle.id);
        const stoodIn = before
          ? { ...piece, x: before.x - dx, y: before.y - dy }
          : piece;
        if (
          !touches(previous) ||
          hitboxBlocksPath(
            stoodIn,
            movement.oldX,
            movement.oldY,
            movement.oldX,
            movement.oldY,
            RIDER_OBSTACLE_RADIUS,
          )
        )
          continue;
        obstacleContactTimes.set(
          movement.player.id,
          firstContactTime(touches, previous),
        );
        obstaclesReached.set(movement.player.id, piece);
      }
    }

    // A step that reaches past an open edge is also tested from the far side, where the trails it is about to meet are.
    const images = open
      ? movementImages(state, movement, RIDER_CONTACT_RADIUS + TRAIL_WIDTH / 2)
      : NO_WRAP;
    for (const owner of sortedPlayers(state)) {
      if (isHazardImmune(movement.player, state.tick)) break;
      for (const trail of owner.trail) {
        if (
          owner.id === movement.player.id &&
          trail.createdTick > state.tick - SELF_TRAIL_GRACE_TICKS
        )
          continue;
        for (const { dx, dy } of images) {
          const fromX = movement.oldX + dx,
            fromY = movement.oldY + dy,
            toX = movement.x + dx,
            toY = movement.y + dy;
          if (
            segmentDistanceSquared(
              fromX,
              fromY,
              toX,
              toY,
              trail.x1,
              trail.y1,
              trail.x2,
              trail.y2,
            ) >
            square(RIDER_CONTACT_RADIUS + TRAIL_WIDTH / 2) + EPSILON
          )
            continue;
          markCause(causes, causeOwners, movement.player.id, "trail", owner.id);
          const previous = trailContactTimes.get(movement.player.id) ?? 1;
          const time = firstContactTime(
            (time) =>
              segmentDistanceSquared(
                fromX,
                fromY,
                fromX + (toX - fromX) * time,
                fromY + (toY - fromY) * time,
                trail.x1,
                trail.y1,
                trail.x2,
                trail.y2,
              ) <=
              square(RIDER_CONTACT_RADIUS + TRAIL_WIDTH / 2) + EPSILON,
            previous,
          );
          trailContactTimes.set(movement.player.id, time);
          if (!trailHits.has(movement.player.id))
            trailHits.set(movement.player.id, {
              ownerId: owner.id,
              age: state.tick - trail.createdTick,
            });
        }
      }
    }
  }
}
