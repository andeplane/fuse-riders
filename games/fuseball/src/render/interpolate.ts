import type { WorldView } from "../engine/view.js";
import { VIEW_H, VIEW_W, mapOf } from "../engine/view-kit.js";

/**
 * A coordinate `alpha` of the way from `from` to `to` along an axis `size` long.
 *
 * On an axis that wraps, a body that crossed the seam between the two frames goes the short way round and comes out
 * inside the field, so it leaves by one edge and enters by the other instead of sweeping back across the arena. On
 * an axis that does not wrap, a move of more than half the field is a teleport (a point reset), not motion: snap.
 */
export function between(
  from: number,
  to: number,
  alpha: number,
  size: number,
  wraps: boolean,
): number {
  let delta = to - from;
  if (!wraps) return Math.abs(delta) > size / 2 ? to : from + delta * alpha;
  if (delta > size / 2) delta -= size;
  else if (delta < -size / 2) delta += size;
  const at = (from + delta * alpha) % size;
  return at < 0 ? at + size : at;
}

/**
 * The world between two views, `alpha` of the way from `older` to `newer`, for drawing only. Riders and the ball
 * move; bubbles stand still, and every flag and counter is the newer view's, so an effect fires on the frame its
 * counter first shows. Views of different arenas, out of order, or either side of a point reset are not blended.
 */
export function blend(
  older: WorldView | null | undefined,
  newer: WorldView,
  alpha: number,
): WorldView {
  if (
    !older ||
    alpha >= 1 ||
    older.mapId !== newer.mapId ||
    older.seed !== newer.seed ||
    older.step > newer.step ||
    (newer.phase === "countdown" && older.phase !== "countdown")
  )
    return newer;
  const a = Math.max(0, alpha),
    map = mapOf(newer.mapId, newer.seed),
    mix = (from: number, to: number) => from + (to - from) * a,
    place = <T extends { x: number; y: number }>(was: T, now: T): T => ({
      ...now,
      x: between(was.x, now.x, a, VIEW_W, map.wrapX),
      y: between(was.y, now.y, a, VIEW_H, map.wrapY),
    });
  return {
    ...newer,
    step: mix(older.step, newer.step),
    remaining:
      older.phase === newer.phase
        ? mix(older.remaining, newer.remaining)
        : newer.remaining,
    riders: [
      place(older.riders[0], newer.riders[0]),
      place(older.riders[1], newer.riders[1]),
    ],
    ball:
      older.ball.live === newer.ball.live
        ? place(older.ball, newer.ball)
        : newer.ball,
  };
}

/** How far between `older` and `newer` the presentation clock `tick` is, 0–1. */
export function fraction(
  olderTick: number | undefined,
  newerTick: number,
  tick: number,
): number {
  if (olderTick === undefined || newerTick <= olderTick) return 1;
  return Math.max(0, Math.min(1, (tick - olderTick) / (newerTick - olderTick)));
}
