import type { GameState, PlayerState, TrailSegment } from "../state.js";
import type { Movement } from "./context.js";
import { RIDER_RADIUS } from "../tuning.js";
import {
  type WrapOffset,
  splitWrappedSegment,
  wrapDelta,
  wrapImages,
} from "../wrap.js";
import { clipTrailSegment } from "../trail-clipping.js";
import { mapWraps } from "../arena-map.js";
import { powerTrailLifetimeTicks } from "../power-progression.js";
/** The field as the tick sees it: the walls, the open edges, and the trail a step leaves on it. */

/** The rectangle inside the walls, which is also where a portal gate or a trail may stand. */
export function portalBounds(state: GameState) {
  return {
    minX: state.boundaryInset,
    minY: state.boundaryInset,
    maxX: state.width - state.boundaryInset,
    maxY: state.height - state.boundaryInset,
  };
}

/**
 * How far from the wall's face a rider dies. A rider's radius, except while a wrap board's walls are first coming in:
 * riders may legally be anywhere up to the very edge when they appear, so the lethal band grows out of the edge over
 * a few ticks instead of arriving a full radius wide in one.
 */
export function wallReach(state: GameState): number {
  return mapWraps(state.map)
    ? Math.min(RIDER_RADIUS, 2 * state.boundaryInset)
    : RIDER_RADIUS;
}

/** The short way round when the edges are open, the plain difference when they are not. */
export function nearestDelta(
  open: boolean,
  delta: number,
  size: number,
): number {
  return open ? wrapDelta(delta, size) : delta;
}

/** Where a step has to be tested from so that it meets everything within `reach` of it, across open edges included. */
export function movementImages(
  state: GameState,
  movement: Movement,
  reach: number,
): WrapOffset[] {
  return wrapImages(
    state.width,
    state.height,
    Math.min(movement.oldX, movement.x) - reach,
    Math.min(movement.oldY, movement.y) - reach,
    Math.max(movement.oldX, movement.x) + reach,
    Math.max(movement.oldY, movement.y) + reach,
  );
}

/**
 * This tick's trail for a step. Walls clip it; an open edge splits it instead, into the piece up to the edge and the
 * piece on from the opposite one. The two never join — same tick, different ends of the board — which is the same
 * logical link with a gap in it that a portal crossing already leaves.
 */
export function layTrail(
  state: GameState,
  open: boolean,
  bounds: ReturnType<typeof portalBounds>,
  player: PlayerState,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): TrailSegment[] {
  const segment: TrailSegment = {
    x1,
    y1,
    x2,
    y2,
    createdTick: state.tick,
    expiresAtTick: state.tick + powerTrailLifetimeTicks(player.powerPickups),
  };
  if (open) return splitWrappedSegment(segment, state.width, state.height);
  const clipped = clipTrailSegment(segment, bounds);
  return clipped ? [clipped] : [];
}
