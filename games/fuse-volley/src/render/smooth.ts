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
   * revision; `local` is this device's blob slot, or −1.
   */
  apply(
    view: WorldView,
    revision: number,
    nowMs: number,
    local: number,
  ): WorldView;
}

export function createSmoother(): Smoother {
  let revision: number | undefined,
    last = -1,
    shown: WorldView | undefined;
  const offsets: { ball: Offset; blobs: Offset[] } = {
    ball: { x: 0, y: 0 },
    blobs: [],
  };
  const offsetOf = (slot: number): Offset =>
    (offsets.blobs[slot] ??= { x: 0, y: 0 });
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
        for (const [slot, blob] of view.blobs.entries()) {
          const was = shown.blobs[slot];
          if (slot !== local && was)
            take(offsetOf(slot), expected(was, before?.blobs[slot], dt), blob);
        }
      }
      revision = nextRevision;
      // A serve teleports the ball: never drag it from the last rally.
      if (view.phase === "serve") {
        offsets.ball = { x: 0, y: 0 };
        offsets.blobs = [];
      }
      const result: WorldView = {
        ...view,
        ball: {
          ...view.ball,
          x: view.ball.x + offsets.ball.x,
          y: view.ball.y + offsets.ball.y,
        },
        blobs: view.blobs.map((blob, slot) => {
          const offset = offsetOf(slot);
          return slot === local
            ? blob
            : {
                ...blob,
                x: blob.x + offset.x,
                y: Math.min(blob.y + offset.y, SAND_Y),
              };
        }),
      };
      before = shown;
      beforeDt = dt;
      shown = result;
      return result;
    },
  };
}
