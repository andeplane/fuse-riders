import type { Movement, TickContext } from "../context.js";
import { PROJECTILE_OWNER_GRACE_TICKS, RIDER_RADIUS } from "../../tuning.js";
import { SHELL_RADIUS } from "../../shell.js";
import { isHazardImmune } from "../../effects.js";
import { markCause, markShot } from "../marks.js";
import { nearestDelta } from "../field.js";
import { sortedBombs } from "../../state.js";
import { square } from "../../geometry.js";

/**
 * What this tick's projectiles reach: a lobbed bomb hits whoever it lands on, a shell whoever its swept path meets first.
 * Both mark `explosion` under the thrower's name, and a shell that hits is spent. Nobody dies yet: marks are only collected.
 */
export function hitProjectiles(ctx: TickContext): void {
  const {
    state,
    open,
    movements,
    shellPaths,
    causes,
    causeOwners,
    shotSources,
    landingHits,
    shellHits,
  } = ctx;
  // Bombs only hit on landing; shells sweep their path to avoid tunnelling.
  for (const bomb of sortedBombs(state)) {
    if (
      bomb.shell?.gun ||
      bomb.launchedTick >= state.tick ||
      (!bomb.shell && bomb.landsAtTick < state.tick)
    )
      continue;
    if (!bomb.shell) {
      if (bomb.landsAtTick !== state.tick) continue;
      for (const movement of movements.values()) {
        if (
          movement.player.id === bomb.ownerId ||
          isHazardImmune(movement.player, state.tick)
        )
          continue;
        if (
          square(nearestDelta(open, movement.x - bomb.x, state.width)) +
            square(nearestDelta(open, movement.y - bomb.y, state.height)) <=
          square(RIDER_RADIUS + SHELL_RADIUS)
        ) {
          markCause(
            causes,
            causeOwners,
            movement.player.id,
            "explosion",
            bomb.ownerId,
          );
          markShot(shotSources, movement.player.id, bomb.id, bomb.shot);
          if (!landingHits.has(movement.player.id))
            landingHits.set(movement.player.id, bomb.ownerId);
        }
      }
      continue;
    }
    let hit: Movement | undefined;
    let hitTime = Infinity;
    for (const path of shellPaths.get(bomb.id) ?? [])
      for (let i = 1; i < path.length; i++) {
        const start = path[i - 1]!;
        const end = path[i]!;
        for (const movement of movements.values()) {
          if (
            (movement.player.id === bomb.ownerId &&
              state.tick - bomb.launchedTick < PROJECTILE_OWNER_GRACE_TICKS) ||
            isHazardImmune(movement.player, state.tick)
          )
            continue;
          const mx = movement.x - movement.oldX;
          const my = movement.y - movement.oldY;
          const px =
            nearestDelta(open, start.x - movement.oldX, state.width) -
            mx * start.t;
          const py =
            nearestDelta(open, start.y - movement.oldY, state.height) -
            my * start.t;
          const vx = end.x - start.x - mx * (end.t - start.t);
          const vy = end.y - start.y - my * (end.t - start.t);
          const radius = RIDER_RADIUS + SHELL_RADIUS;
          const c = px * px + py * py - radius * radius;
          const a = vx * vx + vy * vy;
          const b = 2 * (px * vx + py * vy);
          const discriminant = b * b - 4 * a * c;
          const contact =
            c <= 0
              ? 0
              : a > 0 && discriminant >= 0
                ? (-b - Math.sqrt(discriminant)) / (2 * a)
                : Infinity;
          const time = start.t + contact * (end.t - start.t);
          if (contact >= 0 && contact <= 1 && time < hitTime) {
            hit = movement;
            hitTime = time;
          }
        }
      }
    if (hit) {
      markCause(causes, causeOwners, hit.player.id, "explosion", bomb.ownerId);
      markShot(shotSources, hit.player.id, bomb.id, bomb.shot);
      if (!shellHits.has(hit.player.id))
        shellHits.set(hit.player.id, {
          ownerId: bomb.ownerId,
          bounces: bomb.shell?.bounces ?? 0,
          age: state.tick - bomb.launchedTick,
        });
      state.bombs.delete(bomb.id);
    }
  }
}
