import type { TickContext } from "../context.js";
import { boundTrail } from "../../trail-lifecycle.js";
import { layTrail } from "../field.js";
import { recordPortalTransit } from "../../match-stats.js";
import { wrapCoordinate } from "../../wrap.js";

/**
 * Every step becomes the rider's new place, and lays its trail. A survivor lands where its step ended, or at the far
 * gate of its transit; a rider stopped by a trail, a rider or scenery is left where it hit, with the trail it laid
 * getting there.
 */
export function commitMovement(ctx: TickContext): void {
  const {
    state,
    open,
    trailBounds,
    movements,
    causes,
    causeOwners,
    shotSources,
    transits,
    obstacleContactTimes,
    deaths,
    trailHits,
    landingHits,
    shellHits,
  } = ctx;
  for (const movement of movements.values()) {
    const cause = causes.get(movement.player.id);
    if (cause) {
      // A wreck against scenery is left where it hit, with the trail it laid getting there; the boundary keeps
      // its own behaviour, where the rider has already been carried out of bounds.
      if (
        cause === "trail" ||
        cause === "rider" ||
        (cause === "wall" && obstacleContactTimes.has(movement.player.id))
      ) {
        movement.player.x = open
          ? wrapCoordinate(movement.x, state.width)
          : movement.x;
        movement.player.y = open
          ? wrapCoordinate(movement.y, state.height)
          : movement.y;
        movement.player.angle = movement.angle;
        const laid = layTrail(
          state,
          open,
          trailBounds,
          movement.player,
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
        ).filter((trail) => trail.x1 !== trail.x2 || trail.y1 !== trail.y2);
        if (laid.length)
          movement.player.trail = boundTrail([
            ...movement.player.trail,
            ...laid,
          ]);
      }
      const trailHit =
        cause === "trail" ? trailHits.get(movement.player.id) : undefined;
      const landingHit = landingHits.get(movement.player.id),
        shellHit = shellHits.get(movement.player.id);
      const shot =
        cause === "explosion"
          ? shotSources.get(movement.player.id)?.shot
          : undefined;
      deaths.push({
        victim: movement.player,
        cause,
        owners: [...(causeOwners.get(movement.player.id)?.get(cause) ?? [])],
        ...(shot === undefined ? {} : { shot }),
        x: movement.x,
        y: movement.y,
        ...(trailHit ? { trailAge: trailHit.age } : {}),
        ...(landingHit ? { landingHit } : {}),
        ...(shellHit ? { shellHit } : {}),
      });
      continue;
    }
    const transit = transits.get(movement.player.id);
    movement.player.x =
      transit?.exitPoint.x ??
      (open ? wrapCoordinate(movement.x, state.width) : movement.x);
    movement.player.y =
      transit?.exitPoint.y ??
      (open ? wrapCoordinate(movement.y, state.height) : movement.y);
    if (transit) {
      movement.player.portalCooldownUntilTick = transit.cooldownUntilTick;
      movement.player.portalGraceUntilTick = transit.graceUntilTick;
      recordPortalTransit(state.matchStats, movement.player.id);
    }
    movement.player.angle = movement.angle;
    const laid = layTrail(
      state,
      open,
      trailBounds,
      movement.player,
      movement.oldX,
      movement.oldY,
      transit?.entryPoint.x ?? movement.x,
      transit?.entryPoint.y ?? movement.y,
    );
    if (laid.length)
      movement.player.trail = boundTrail([...movement.player.trail, ...laid]);
  }
}
