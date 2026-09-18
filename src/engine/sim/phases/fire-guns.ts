import type { TickContext } from "../context.js";
import {
  type GameState,
  type PlayerId,
  type PlayerState,
  type TracerState,
  sortedObstacles,
  sortedPlayers,
} from "../../state.js";
import {
  GUN_HEADSHOT_RADIUS,
  GUN_HOLE_RADIUS,
  GUN_RADIUS,
  cutTrailHole,
} from "../../gun.js";
import {
  MAX_PORTAL_PAIRS,
  type PortalPoint,
  type PortalTransit,
  findPortalTransit,
} from "../../portal.js";
import { NO_WRAP, wrapImages } from "../../wrap.js";
import { RIDER_RADIUS, TRAIL_WIDTH } from "../../tuning.js";
import { cutTrail } from "../../trail-lifecycle.js";
import { edgesOpen, segmentObstacleDistanceSquared } from "../../arena-map.js";
import {
  firstContactTime,
  segmentDistanceSquared,
  square,
} from "../../geometry.js";
import { hypot2 } from "../../deterministic-math.js";
import { isClearOfPortalWalls } from "../portals.js";
import { nearestDelta, portalBounds } from "../field.js";

/**
 * Every gun fired this tick is resolved against the same committed board, before any cut or death is applied.
 */
export function fireGuns(ctx: TickContext): void {
  const { state } = ctx;
  ctx.gunHits = resolveGunShots(state);
}

/**
 * The first unspent gate a gun ray meets, as a fraction of the cast segment. A bullet is a point at
 * this scale, so only portal-wall clearance can refuse the exit — a rider or a trail waiting there is
 * exactly what the shooter aimed for.
 */
function findGunPortalEntry(
  state: GameState,
  from: PortalPoint,
  to: PortalPoint,
  spent: ReadonlySet<string>,
): { transit: PortalTransit; time: number } | undefined {
  const transit = findPortalTransit({
    pairs: state.portalPairs.filter((pair) => !spent.has(pair.id)),
    tick: state.tick,
    from,
    to,
    cooldownUntilTick: 0, // A ray lives for one tick, so it has no cooldown of its own.
    bounds: portalBounds(state),
    riderRadius: GUN_RADIUS,
    isSafeExit: (point, radius, pairId) =>
      isClearOfPortalWalls(state, point, radius, pairId),
  });
  if (!transit) return undefined;
  const span = hypot2(to.x - from.x, to.y - from.y);
  if (span === 0) return undefined;
  return {
    transit,
    time:
      hypot2(transit.entryPoint.x - from.x, transit.entryPoint.y - from.y) /
      span,
  };
}

/**
 * One more tracer for the stretch of a ray past a gate, so the renderer keeps drawing every segment as
 * the straight line it is. It records no placement: the trigger was pulled once, and this is still that bullet.
 */
function continueGunTracer(
  state: GameState,
  bullet: TracerState,
  from: PortalPoint,
): TracerState {
  const tracer: TracerState = {
    ...bullet,
    id: state.nextBombId++,
    launchX: from.x,
    launchY: from.y,
    x: from.x,
    y: from.y,
  };
  state.tracers.push(tracer);
  return tracer;
}

/** Edges one bullet can cross inside its range: a board's width of travel spans the board once across and twice down. */
const GUN_WRAP_LEGS = 4;

/** Raycast against heads, trails and walls. All shots see the same board, including simultaneous volleys. */
function resolveGunShots(
  state: GameState,
): Map<PlayerId, { bombId: number; ownerId: PlayerId; shot?: number }[]> {
  const hits = new Map<
    PlayerId,
    { bombId: number; ownerId: PlayerId; shot?: number }[]
  >();
  const impacts: { x: number; y: number }[] = [];
  // Snapshot first: a ray that crosses a gate adds tracers for the segments past it, and those are
  // already resolved — re-reading them here would cast the same bullet twice.
  const fired = [...state.tracers]
    .filter((tracer) => tracer.launchedTick === state.tick)
    .sort((a, b) => a.id - b.id);
  for (const bullet of fired) {
    const { vx, vy } = bullet;
    let segment = bullet;
    // Each pair carries a ray once, so two gates facing each other cannot hold a bullet in a loop.
    const spent = new Set<string>();
    // Over open edges a bullet flies on from the opposite side, for one board's width in all: far enough to shoot
    // through any edge at anything on screen, and an end to a ray that would otherwise circle an empty board for ever.
    const open = edgesOpen(state);
    let range = open ? state.width : Infinity;
    for (
      let hop = 0, leg = 0;
      hop <= MAX_PORTAL_PAIRS && leg <= MAX_PORTAL_PAIRS + GUN_WRAP_LEGS;
      leg += 1
    ) {
      const x = segment.launchX,
        y = segment.launchY;
      const inset = open ? 0 : state.boundaryInset + GUN_RADIUS;
      const wallX =
        vx > 0
          ? (state.width - inset - x) / vx
          : vx < 0
            ? (inset - x) / vx
            : Infinity;
      const wallY =
        vy > 0
          ? (state.height - inset - y) / vy
          : vy < 0
            ? (inset - y) / vy
            : Infinity;
      const distance = Math.max(0, Math.min(wallX, wallY, range));
      const dx = vx * distance,
        dy = vy * distance;
      let contact = 1;
      let hit: PlayerState | undefined;
      const gunReach = RIDER_RADIUS + GUN_RADIUS;
      const legImages = open
        ? wrapImages(
            state.width,
            state.height,
            Math.min(x, x + dx) - gunReach,
            Math.min(y, y + dy) - gunReach,
            Math.max(x, x + dx) + gunReach,
            Math.max(y, y + dy) + gunReach,
          )
        : NO_WRAP;
      // Slot order is stable even when a checkpoint was decoded with another Map insertion order.
      for (const player of sortedPlayers(state)) {
        if (player.id === bullet.ownerId) continue;
        const consider = (
          x1: number,
          y1: number,
          x2: number,
          y2: number,
          radius: number,
        ): void => {
          const touches = (t: number): boolean =>
            segmentDistanceSquared(
              x,
              y,
              x + dx * t,
              y + dy * t,
              x1,
              y1,
              x2,
              y2,
            ) <= square(radius);
          if (!touches(contact)) return;
          const time = firstContactTime(touches);
          if (time < contact || !hit) {
            contact = time;
            hit = player;
          }
        };
        // A leg along an open edge also meets what overhangs that edge from the far side.
        for (const image of legImages) {
          if (player.alive)
            consider(
              player.x - image.dx,
              player.y - image.dy,
              player.x - image.dx,
              player.y - image.dy,
              RIDER_RADIUS + GUN_RADIUS,
            );
          for (const trail of player.trail)
            consider(
              trail.x1 - image.dx,
              trail.y1 - image.dy,
              trail.x2 - image.dx,
              trail.y2 - image.dy,
              TRAIL_WIDTH / 2 + GUN_RADIUS,
            );
        }
      }
      // Scenery stops a bullet without taking damage from it: only a blast clears an obstacle. Whatever stood
      // behind it was never in this ray's line, so an earlier obstacle contact also drops the rider it found.
      // Id order: each bisection starts from the contact before it, so the order decides its low bits.
      for (const obstacle of sortedObstacles(state)) {
        const touches = (t: number): boolean =>
          segmentObstacleDistanceSquared(
            obstacle,
            x,
            y,
            x + dx * t,
            y + dy * t,
          ) <= square(GUN_RADIUS);
        if (!touches(contact)) continue;
        contact = firstContactTime(touches, contact);
        hit = undefined;
      }
      const gate = findGunPortalEntry(
        state,
        { x, y },
        { x: x + dx, y: y + dy },
        spent,
      );
      // A gate reached before anything solid takes the bullet; whatever stood beyond it never saw this ray.
      if (gate && gate.time < contact && hop < MAX_PORTAL_PAIRS) {
        segment.x = gate.transit.entryPoint.x;
        segment.y = gate.transit.entryPoint.y;
        spent.add(gate.transit.pairId);
        segment = continueGunTracer(state, bullet, gate.transit.exitPoint);
        range -= distance * gate.time;
        hop += 1;
        continue;
      }
      segment.x = x + dx * contact;
      segment.y = y + dy * contact;
      // Nothing in the way and range to spare: the ray reached an open edge, and carries on from the one opposite.
      // The edge it reached is set exactly rather than computed, so the next leg starts on the board.
      if (
        !hit &&
        contact === 1 &&
        open &&
        range > distance &&
        distance < Infinity
      ) {
        range -= distance;
        const throughX = wallX <= wallY,
          throughY = wallY <= wallX;
        if (throughX) segment.x = vx > 0 ? state.width : 0;
        if (throughY) segment.y = vy > 0 ? state.height : 0;
        segment = continueGunTracer(state, bullet, {
          x: throughX ? (vx > 0 ? 0 : state.width) : segment.x,
          y: throughY ? (vy > 0 ? 0 : state.height) : segment.y,
        });
        continue;
      }
      if (!hit) break;
      // The hole is cut wherever the impact reaches, which near an open edge includes the trail on the far side.
      for (const { dx: shiftX, dy: shiftY } of open
        ? wrapImages(
            state.width,
            state.height,
            segment.x - GUN_HOLE_RADIUS,
            segment.y - GUN_HOLE_RADIUS,
            segment.x + GUN_HOLE_RADIUS,
            segment.y + GUN_HOLE_RADIUS,
          )
        : NO_WRAP)
        impacts.push({ x: segment.x + shiftX, y: segment.y + shiftY });
      // A body hit is only lethal near that body's own living head, never through splash.
      if (
        hit.alive &&
        square(nearestDelta(open, hit.x - segment.x, state.width)) +
          square(nearestDelta(open, hit.y - segment.y, state.height)) <=
          square(GUN_HEADSHOT_RADIUS)
      ) {
        const previous = hits.get(hit.id) ?? [];
        previous.push({
          bombId: bullet.id,
          ownerId: bullet.ownerId,
          shot: bullet.shot,
        });
        hits.set(hit.id, previous);
      }
      break;
    }
  }
  for (const impact of impacts)
    for (const player of sortedPlayers(state)) {
      player.trail = cutTrail(
        player.trail,
        state.tick,
        (trail) => cutTrailHole(trail, impact.x, impact.y, GUN_HOLE_RADIUS),
        () => state.nextTrailPieceId++,
      );
    }
  return hits;
}
