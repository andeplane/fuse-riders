import type { WorldView } from "../engine/view.js";
import { SAND_Y, STEPS_PER_SECOND } from "../engine/view-kit.js";

/**
 * Hides rollback corrections. When the runtime replaces displayed history (its frame revision changes), the ball and
 * the other side's blob may jump to where the confirmed inputs put them; instead of snapping, the screen keeps them
 * where they were drawn and lets the offset decay (a 45 ms time constant, nearly gone by 150 ms). The local blob is never smoothed: it must follow
 * its player's hands exactly. A jump larger than `TELEPORT` (a new serve) is shown as it is.
 */
export const DECAY_MS = 45,
  TELEPORT = 120;

interface Offset {
  x: number;
  y: number;
}

export interface Smoother {
  /**
   * The view to draw at wall time `nowMs`: `view` with the current offsets applied. `revision` is the runtime's frame
   * revision; `local` is this device's side, or −1.
   */
  apply(
    view: WorldView,
    revision: number,
    nowMs: number,
    local: -1 | 0 | 1,
  ): WorldView;
}

export function createSmoother(): Smoother {
  let revision: number | undefined,
    last = -1,
    shown: WorldView | undefined;
  const offsets: { ball: Offset; blobs: [Offset, Offset] } = {
    ball: { x: 0, y: 0 },
    blobs: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  };
  /** Where the screen showed something last frame, moved on by `dt` at the speed it was moving then. */
  let before: WorldView | undefined,
    beforeDt = 0;
  const expected = (
    now: { x: number; y: number },
    then: { x: number; y: number } | undefined,
    dt: number,
  ) =>
    then && beforeDt > 0
      ? {
          x: now.x + ((now.x - then.x) * dt) / beforeDt,
          y: now.y + ((now.y - then.y) * dt) / beforeDt,
        }
      : now;
  const take = (
    offset: Offset,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const dx = from.x - to.x,
      dy = from.y - to.y;
    if (Math.hypot(dx, dy) > TELEPORT) {
      offset.x = 0;
      offset.y = 0;
      return;
    }
    offset.x = dx;
    offset.y = dy;
  };
  return {
    apply(view, nextRevision, nowMs, local) {
      const dt = last < 0 ? 0 : Math.max(0, nowMs - last);
      last = nowMs;
      const fade = Math.exp(-dt / DECAY_MS);
      for (const offset of [offsets.ball, ...offsets.blobs]) {
        offset.x *= fade;
        offset.y *= fade;
        if (Math.abs(offset.x) < 0.05) offset.x = 0;
        if (Math.abs(offset.y) < 0.05) offset.y = 0;
      }
      if (revision !== undefined && nextRevision !== revision && shown) {
        // The correction is the gap between the new picture and where the old one would be by now, not where it was.
        const steps = (dt * STEPS_PER_SECOND) / 1000;
        take(
          offsets.ball,
          {
            x: shown.ball.x + shown.ball.vx * steps,
            y: shown.ball.y + shown.ball.vy * steps,
          },
          view.ball,
        );
        for (const side of [0, 1] as const)
          if (side !== local)
            take(
              offsets.blobs[side],
              expected(shown.blobs[side], before?.blobs[side], dt),
              view.blobs[side],
            );
      }
      revision = nextRevision;
      // A serve teleports the ball: never drag it from the last rally.
      if (view.phase === "serve") {
        offsets.ball = { x: 0, y: 0 };
        offsets.blobs = [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ];
      }
      const result: WorldView = {
        ...view,
        ball: {
          ...view.ball,
          x: view.ball.x + offsets.ball.x,
          y: view.ball.y + offsets.ball.y,
        },
        blobs: [0, 1].map((side) => {
          const blob = view.blobs[side as 0 | 1],
            offset = offsets.blobs[side as 0 | 1];
          return side === local
            ? blob
            : {
                ...blob,
                x: blob.x + offset.x,
                y: Math.min(blob.y + offset.y, SAND_Y),
              };
        }) as WorldView["blobs"],
      };
      before = shown;
      beforeDt = dt;
      shown = result;
      return result;
    },
  };
}
