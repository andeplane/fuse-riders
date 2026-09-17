import type { TickContext } from "../context.js";
import { boundTrail } from "../../trail-lifecycle.js";
import { layTrail } from "../field.js";
import { recordDeath, recordPortalTransit } from "../../match-stats.js";
import { wrapCoordinate } from "../../wrap.js";
import {
  logShotKill,
  recordElimination,
  soleCreditedOwner,
} from "../recording.js";

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
    events,
    movements,
    causes,
    causeOwners,
    shotSources,
    transits,
    obstacleContactTimes,
    observations,
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
      movement.player.alive = false;
      movement.player.bombChargeStartedTick = undefined;
      movement.player.bombTarget = undefined;
      recordElimination(state, movement.player.id);
      const credited = soleCreditedOwner(
        causeOwners,
        movement.player.id,
        cause,
      );
      recordDeath(
        state.matchStats,
        movement.player.id,
        cause,
        causeOwners.get(movement.player.id)?.get(cause)?.size === 1
          ? causeOwners.get(movement.player.id)!.get(cause)!.values().next()
              .value
          : undefined,
        cause === "explosion"
          ? causeOwners.get(movement.player.id)?.get(cause)?.size === 1
            ? (state.shots.find(
                (s) => s.shot === shotSources.get(movement.player.id)?.shot,
              )?.weapon ?? "unknown")
            : "unknown"
          : cause,
      );
      if (cause === "explosion")
        logShotKill(
          state,
          movement.player.id,
          credited,
          shotSources.get(movement.player.id)?.shot,
        );
      events.push({
        type: "playerEliminated",
        playerId: movement.player.id,
        cause,
      });
      const trailHit =
        cause === "trail" ? trailHits.get(movement.player.id) : undefined;
      const landingHit = landingHits.get(movement.player.id),
        shellHit = shellHits.get(movement.player.id);
      observations.deaths.push({
        victimId: movement.player.id,
        cause,
        owners: [...(causeOwners.get(movement.player.id)?.get(cause) ?? [])],
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
