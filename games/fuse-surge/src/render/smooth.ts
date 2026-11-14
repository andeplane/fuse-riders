import type { WorldView } from "../engine/view.js";

/**
 * Hides rollback corrections. When the runtime replaces displayed history (its frame revision changes), another
 * rider may jump to where the confirmed inputs put it; instead of snapping, the screen keeps it where it was drawn
 * and lets the offset decay (a 45 ms time constant, nearly gone by 150 ms). The local rider is never smoothed: it
 * must follow its player's hands exactly. A jump larger than `TELEPORT` (a new round) is shown as it is.
 */
export const DECAY_MS = 45,
  TELEPORT = 140;

interface Offset {
  x: number;
  y: number;
}

export interface Smoother {
  /**
   * The view to draw at wall time `nowMs`: `view` with the current offsets applied. `revision` is the runtime's frame
   * revision; `local` is this device's rider slot, or −1.
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
  let offsets: Offset[] = [];
  const offsetOf = (slot: number): Offset => (offsets[slot] ??= { x: 0, y: 0 });
  return {
    apply(view, nextRevision, nowMs, local) {
      const dt = last < 0 ? 0 : Math.max(0, nowMs - last);
      last = nowMs;
      const fade = Math.exp(-dt / DECAY_MS);
      for (const offset of offsets) {
        offset.x *= fade;
        offset.y *= fade;
        if (Math.abs(offset.x) < 0.05) offset.x = 0;
        if (Math.abs(offset.y) < 0.05) offset.y = 0;
      }
      if (revision !== undefined && nextRevision !== revision && shown)
        for (const [slot, rider] of view.riders.entries()) {
          const was = shown.riders[slot];
          if (slot === local || !was) continue;
          const offset = offsetOf(slot),
            dx = was.x - rider.x,
            dy = was.y - rider.y;
          const far = Math.hypot(dx, dy) > TELEPORT;
          offset.x = far ? 0 : dx;
          offset.y = far ? 0 : dy;
        }
      revision = nextRevision;
      // A new round puts everyone back on the start line: never drag a rider there from where it fell.
      if (shown && shown.round !== view.round) offsets = [];
      const result: WorldView = {
        ...view,
        riders: view.riders.map((rider, slot) => {
          const offset = offsetOf(slot);
          return slot === local || (!offset.x && !offset.y)
            ? rider
            : {
                ...rider,
                x: rider.x + offset.x,
                // A rider on the deck is never drawn under it.
                y:
                  rider.out || rider.y + offset.y >= 0 ? rider.y + offset.y : 0,
              };
        }),
      };
      shown = result;
      return result;
    },
  };
}
