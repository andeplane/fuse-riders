import type { WorldView } from "../engine/view.js";
import { SAND_Y } from "../engine/view-kit.js";

/**
 * Everything that happened between two views that the presentation shows or sounds, read off the wrapping counters
 * and flags changing, never stored in the simulation. A rollback that replays a step leaves a counter where it was,
 * so nothing fires twice; a counter that went backwards (a rollback past it, or a new match) says nothing.
 */
export type Cue =
  /** A blob touched the ball; `speed` is the ball's speed after it, px a step. */
  | {
      kind: "hit";
      side: 0 | 1;
      x: number;
      y: number;
      speed: number;
      touches: number;
    }
  /** The ball met the net's top or its pole. */
  | { kind: "net"; x: number; y: number }
  /** The ball hit the sand hard enough to hear. */
  | { kind: "floor"; x: number; speed: number }
  /** A blob landed from a jump. */
  | { kind: "land"; side: 0 | 1; x: number }
  /** A blob left the sand. */
  | { kind: "jump"; side: 0 | 1; x: number }
  /** A rally ended against `loser`; `scored` is false for a classic side-out. */
  | { kind: "point"; loser: 0 | 1; scored: boolean; matchPoint: -1 | 0 | 1 }
  /** A new serve hovers over `side`'s half. */
  | { kind: "serve"; side: 0 | 1 }
  /** The match is over. */
  | { kind: "over"; winner: 0 | 1 };

/** How far a wrapping counter moved forward from `before` to `after`: 0 if it did not, or went backwards. */
export function advanced(before: number, after: number): number {
  const delta = (after - before + 0x10000) % 0x10000;
  return delta > 0 && delta < 0x8000 ? delta : 0;
}

export function cuesBetween(
  before: WorldView | undefined,
  after: WorldView,
): Cue[] {
  if (!before || before.step > after.step) return [];
  const cues: Cue[] = [];
  const ball = after.ball,
    speed = Math.hypot(ball.vx, ball.vy);
  if (advanced(before.hitCounter, after.hitCounter) && after.lastTouch !== -1)
    cues.push({
      kind: "hit",
      side: after.lastTouch,
      x: ball.x,
      y: ball.y,
      speed,
      touches: after.blobs[after.lastTouch].touches,
    });
  if (advanced(before.netCounter, after.netCounter))
    cues.push({ kind: "net", x: ball.x, y: ball.y });
  if (advanced(before.floorCounter, after.floorCounter))
    cues.push({ kind: "floor", x: ball.x, speed });
  for (const side of [0, 1] as const) {
    const was = before.blobs[side],
      now = after.blobs[side];
    if (was.air && !now.air) cues.push({ kind: "land", side, x: now.x });
    if (!was.air && now.air) cues.push({ kind: "jump", side, x: now.x });
  }
  if (
    advanced(before.pointCounter, after.pointCounter) &&
    after.lastFault !== -1
  )
    cues.push({
      kind: "point",
      loser: after.lastFault,
      scored:
        after.score[0] + after.score[1] > before.score[0] + before.score[1],
      matchPoint: after.matchPoint,
    });
  if (after.phase === "serve" && before.phase !== "serve")
    cues.push({ kind: "serve", side: after.server });
  if (after.phase === "over" && before.phase !== "over" && after.winner !== -1)
    cues.push({ kind: "over", winner: after.winner });
  return cues;
}

/** The ball's bottom is on the sand. */
export const ballGrounded = (view: WorldView): boolean =>
  view.ball.y >= SAND_Y - 32 - 0.5;
