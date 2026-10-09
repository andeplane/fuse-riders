/**
 * Scenery that moves: the wandering cross of the `drift` map and the trains of the `trains` map.
 *
 * A mover is an ordinary obstacle — lethal to ride into, solid to shells and bullets, kept clear of by pickups and
 * gates — that carries a `motion`, and is advanced one step per tick by the `moveScenery` phase before anyone rides.
 * Its position is state, so a checkpoint restores a train exactly where it was and every replica advances it from
 * there with the same arithmetic. The tracks it runs on are state as well (`GameState.tracks`, laid each round by
 * `layRailway`), and reach a screen through the view. Movers are permanent (`PERMANENT_OBSTACLE_KINDS`): a blast
 * does not clear one and the overtime walls do not crush one, because a map is its movers, and a railway with
 * nothing on it is the classic arena.
 */
import type { ArenaMapId, Obstacle } from "./arena-map.js";
import { hypot2 } from "./deterministic-math.js";
import { wrapCoordinate } from "./wrap.js";

export type ObstacleMotion =
  /** Straight on at a fixed velocity in units per tick, turned back by the board's edges: the screensaver logo. */
  | { kind: "bounce"; vx: number; vy: number }
  /**
   * A car on a track: `along` is its distance round the loop from the track's first point, `speed` is signed units
   * per tick (negative runs the loop the other way) and `train` says which train of the round's railway it is a car of.
   */
  | {
      kind: "rail";
      track: number;
      along: number;
      speed: number;
      train: number;
    };

export interface TrackPoint {
  x: number;
  y: number;
}
/** A closed loop of straight rails through `points`, the last joined back to the first. Nothing collides with a track. */
export interface Track {
  points: readonly TrackPoint[];
}

/** Where a track is at `along` units from its first point, and the unit direction the rails run in there. */
export interface TrackPose {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** A car is a square, so it rounds a corner without turning: the same footprint faces every way. */
export const TRAIN_CAR_HALF_SIZE = 16;
/** Centre to centre, so cars run with a small gap between them. */
export const TRAIN_CAR_SPACING = 36;
/** Half the thickness of a drifting wall, the thickness of the pixel style's boundary wall. */
export const CROSS_WALL_HALF_THICKNESS = 6;
/** Units per tick each wall slides along its normal: 2.4 across and 1.8 down, so the crossing point moves 3 a tick, 60 a second, against a rider's 150 at the start of a round. */
export const DRIFT_VELOCITY = Object.freeze({ vx: 2.4, vy: 1.8 });
/** Bounds checkpoint decoding admits, well over anything a map defines. */
export const MAX_MOVER_SPEED = 50;

export function trackLength(track: Track): number {
  let length = 0;
  for (let index = 0; index < track.points.length; index += 1) {
    const from = track.points[index]!;
    const to = track.points[(index + 1) % track.points.length]!;
    length += hypot2(to.x - from.x, to.y - from.y);
  }
  return length;
}

/** `along` past the loop's length lands where the loop's start does; plain arithmetic throughout, so every replica agrees. */
export function trackPose(track: Track, along: number): TrackPose {
  const count = track.points.length;
  let remaining = Math.max(0, along);
  for (let index = 0; index < count; index += 1) {
    const from = track.points[index]!;
    const to = track.points[(index + 1) % count]!;
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const length = hypot2(dx, dy);
    if (remaining <= length || index === count - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      return {
        x: from.x + dx * t,
        y: from.y + dy * t,
        dx: length > 0 ? dx / length : 1,
        dy: length > 0 ? dy / length : 0,
      };
    }
    remaining -= length;
  }
  const first = track.points[0] ?? { x: 0, y: 0 };
  return { x: first.x, y: first.y, dx: 1, dy: 0 };
}

/**
 * The movers a map starts a round with whatever the stream says, ids continuing from `firstId`: the drifting cross,
 * laid the same way every round. The trains are not fixed; `layRailway` (`railway.ts`) lays them from the stream.
 */
export function fixedScenery(
  map: ArenaMapId,
  width: number,
  height: number,
  firstId: number,
): Obstacle[] {
  let id = firstId;
  if (map === "drift") {
    const t = CROSS_WALL_HALF_THICKNESS;
    // The cross starts on the board's edges — the classic room, its walls about to wander — and each wall spans the
    // whole board across, so the only thing it does is slide along its normal.
    return [
      {
        id: id++,
        kind: "wall",
        x: width / 2,
        y: t,
        halfWidth: width / 2,
        halfHeight: t,
        motion: { kind: "bounce", vx: 0, vy: DRIFT_VELOCITY.vy },
      },
      {
        id: id++,
        kind: "wall",
        x: t,
        y: height / 2,
        halfWidth: t,
        halfHeight: height / 2,
        motion: { kind: "bounce", vx: DRIFT_VELOCITY.vx, vy: 0 },
      },
    ];
  }
  return [];
}

/**
 * A value stepped by `velocity` and turned back wherever it left [min, max]; a range too small to move in pins it.
 * The reflected value is clamped as well: a step longer than the range (nothing a map defines, but within what a
 * checkpoint admits) would otherwise reflect out the other side, and the piece must never leave the board.
 */
function reflect(
  value: number,
  velocity: number,
  min: number,
  max: number,
): { value: number; velocity: number } {
  if (max <= min) return { value: (min + max) / 2, velocity: 0 };
  const next = value + velocity;
  if (next < min)
    return {
      value: Math.min(max, min + (min - next)),
      velocity: -velocity,
    };
  if (next > max)
    return {
      value: Math.max(min, max - (next - max)),
      velocity: -velocity,
    };
  return { value: next, velocity };
}

/**
 * One tick of a mover, in place. A bouncing piece keeps its whole rectangle on the board, so it is never anywhere a
 * checkpoint would refuse; a car folds its distance round the loop and stands where the track puts it.
 */
export function advanceScenery(
  obstacle: Obstacle,
  width: number,
  height: number,
  tracks: readonly Track[],
): void {
  const motion = obstacle.motion;
  if (!motion) return;
  if (motion.kind === "bounce") {
    const x = reflect(
      obstacle.x,
      motion.vx,
      obstacle.halfWidth,
      width - obstacle.halfWidth,
    );
    const y = reflect(
      obstacle.y,
      motion.vy,
      obstacle.halfHeight,
      height - obstacle.halfHeight,
    );
    obstacle.x = x.value;
    obstacle.y = y.value;
    motion.vx = x.velocity;
    motion.vy = y.velocity;
    return;
  }
  const track = tracks[motion.track];
  if (!track) return;
  motion.along = wrapCoordinate(
    motion.along + motion.speed,
    trackLength(track),
  );
  const pose = trackPose(track, motion.along);
  obstacle.x = pose.x;
  obstacle.y = pose.y;
}
