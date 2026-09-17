import type { TickContext } from "../context.js";
import {
  type BombState,
  type GameState,
  sortedBombs,
  sortedObstacles,
  sortedPlayers,
} from "../../state.js";
import {
  PROJECTILE_OWNER_GRACE_TICKS,
  TICK_HZ,
  TRAIL_WIDTH,
} from "../../tuning.js";
import { type PortalTransit, findPortalTransit } from "../../portal.js";
import {
  SHELL_RADIUS,
  SHELL_SPEED,
  type ShellPoint,
  type ShellTrail,
  advanceShell,
} from "../../shell.js";
import { hypot2 } from "../../deterministic-math.js";
import { isClearOfPortalWalls } from "../portals.js";
import { obstacleDistanceSquared, obstacleEdges } from "../../arena-map.js";
import { portalBounds } from "../field.js";
import { wrapCoordinate, wrapImages } from "../../wrap.js";

/**
 * Shells fly their tick: off walls, trails and scenery, through a gate if they meet one, and across open edges.
 * The swept path is kept for the hit test that follows. A gun tracer past its few ticks of display is removed here.
 */
export function moveShells(ctx: TickContext): void {
  const { state, open, shellPaths } = ctx;
  // One run per portal hop. The gap between runs is travel the shell never made, so the sweep below
  // must not read across it: a rider standing between two gates is not in the way of a teleport.
  for (const bomb of sortedBombs(state)) {
    if (!bomb.shell) continue;
    // Gun damage was resolved on press; these are stationary, harmless tracers.
    if (bomb.shell.gun) {
      if (state.tick >= bomb.explodeAtTick) state.bombs.delete(bomb.id);
      continue;
    }
    // Open edges have nothing to bounce off: the bounds sit a whole board away, further than any tick can reach.
    const shellBounds = open
      ? {
          left: -state.width,
          right: 2 * state.width,
          top: -state.height,
          bottom: 2 * state.height,
        }
      : {
          left: state.boundaryInset + SHELL_RADIUS,
          right: state.width - state.boundaryInset - SHELL_RADIUS,
          top: state.boundaryInset + SHELL_RADIUS,
          bottom: state.height - state.boundaryInset - SHELL_RADIUS,
        };
    // Scenery reflects a shell exactly as a trail does; it is the one surface a shell meets that it cannot cut.
    // An edge reflects from either side, so a shell fired by an immune rider from inside an obstacle would rattle
    // between its walls for ever. The obstacle a shell is inside of lets it out, as it lets the rider out.
    const obstacleWalls = sortedObstacles(state)
      .filter(
        (obstacle) => obstacleDistanceSquared(obstacle, bomb.x, bomb.y) > 0,
      )
      .flatMap(obstacleEdges);
    const solid: ShellTrail[] = [
      ...obstacleWalls,
      ...sortedPlayers(state).flatMap((player) =>
        player.id === bomb.ownerId &&
        state.tick - bomb.launchedTick < PROJECTILE_OWNER_GRACE_TICKS
          ? []
          : player.trail,
      ),
    ];
    // A shell about to cross an edge also meets what stands just beyond it, which the state holds on the far side.
    const shellReach = SHELL_SPEED / TICK_HZ + SHELL_RADIUS + TRAIL_WIDTH / 2;
    const trails = open
      ? wrapImages(
          state.width,
          state.height,
          bomb.x - shellReach,
          bomb.y - shellReach,
          bomb.x + shellReach,
          bomb.y + shellReach,
        ).flatMap(({ dx, dy }) =>
          dx === 0 && dy === 0
            ? solid
            : solid.map((trail) => ({
                x1: trail.x1 - dx,
                y1: trail.y1 - dy,
                x2: trail.x2 - dx,
                y2: trail.y2 - dy,
              })),
        )
      : solid;
    const motion = {
      x: bomb.x,
      y: bomb.y,
      vx: bomb.shell.vx,
      vy: bomb.shell.vy,
      bounces: bomb.shell.bounces ?? 0,
    };
    // A bounce can fall on either side of a gate within one tick, so the tick is integrated twice
    // rather than rewound: this throwaway pass only says whether, and when, a gate is met.
    const provisional = advanceShell(
      { ...motion },
      shellBounds,
      trails,
      TRAIL_WIDTH,
    );
    const entry = findShellPortalEntry(state, bomb, provisional);
    if (entry) {
      const approach = advanceShell(
        motion,
        shellBounds,
        trails,
        TRAIL_WIDTH,
        0,
        entry.time,
      );
      motion.x = entry.transit.exitPoint.x;
      motion.y = entry.transit.exitPoint.y;
      shellPaths.set(bomb.id, [
        approach,
        advanceShell(motion, shellBounds, trails, TRAIL_WIDTH, entry.time),
      ]);
      bomb.portalCooldownUntilTick = entry.transit.cooldownUntilTick;
    } else {
      shellPaths.set(bomb.id, [
        advanceShell(motion, shellBounds, trails, TRAIL_WIDTH),
      ]);
    }
    // The swept path above stays unwrapped for this tick's hit test; only the resting place is folded back.
    bomb.x = open ? wrapCoordinate(motion.x, state.width) : motion.x;
    bomb.y = open ? wrapCoordinate(motion.y, state.height) : motion.y;
    bomb.shell = {
      vx: motion.vx,
      vy: motion.vy,
      ...(motion.bounces ? { bounces: motion.bounces } : {}),
    };
  }
}

/**
 * The first gate a shell's swept path meets this tick, as a fraction of the tick, or nothing.
 * Projectiles are held only to portal-wall clearance at the exit, not to the rider rule: a shell has
 * no problem appearing beside a rider or a trail, and resolves that contact on the ticks that follow.
 */
function findShellPortalEntry(
  state: GameState,
  bomb: BombState,
  path: readonly ShellPoint[],
): { transit: PortalTransit; time: number } | undefined {
  if (!bomb.shell) return undefined;
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1]!;
    const to = path[i]!;
    const transit = findPortalTransit({
      pairs: state.portalPairs,
      tick: state.tick,
      from,
      to,
      heading: 0, // Echoed back by findPortalTransit and read by no caller.
      cooldownUntilTick: bomb.portalCooldownUntilTick ?? 0,
      bounds: portalBounds(state),
      riderRadius: SHELL_RADIUS,
      isSafeExit: (point, radius, pairId) =>
        isClearOfPortalWalls(state, point, radius, pairId),
    });
    if (!transit) continue;
    const span = hypot2(to.x - from.x, to.y - from.y);
    const reached =
      span > 0
        ? hypot2(transit.entryPoint.x - from.x, transit.entryPoint.y - from.y) /
          span
        : 0;
    return {
      transit,
      time: from.t + (to.t - from.t) * Math.max(0, Math.min(1, reached)),
    };
  }
  return undefined;
}
