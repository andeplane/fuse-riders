import type { BikeView, WorldView } from "../engine/view.js";

/**
 * Hides rollback corrections on the other riders. When the runtime replaces displayed history (its frame revision
 * changes), a ghost may jump to where its confirmed inputs put it; instead of snapping, the screen keeps it where it
 * was drawn and lets the offset decay. This device's own bike is never smoothed: it must follow its rider's hands.
 * A jump longer than `TELEPORT` (a restart at the start) is shown as it is.
 */
export const DECAY_MS = 60,
  TELEPORT = 3;

export function shiftBike(bike: BikeView, dx: number, dy: number): BikeView {
  const move = <P extends { x: number; y: number }>(point: P): P => ({
    ...point,
    x: point.x + dx,
    y: point.y + dy,
  });
  return {
    ...move(bike),
    left: move(bike.left),
    right: move(bike.right),
    body: move(bike.body),
    head: move(bike.head),
  };
}

export interface Smoother {
  /** `view` with the current offsets applied; `revision` is the runtime's frame revision, `local` this device's slot or −1. */
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
    shown: WorldView | undefined,
    offsets: { x: number; y: number }[] = [];
  return {
    apply(view, nextRevision, nowMs, local) {
      const dt = last < 0 ? 0 : Math.max(0, nowMs - last);
      last = nowMs;
      const fade = Math.exp(-dt / DECAY_MS);
      for (const offset of offsets) {
        // A slot never corrected has no offset yet.
        if (!offset) continue;
        offset.x = Math.abs(offset.x * fade) < 0.002 ? 0 : offset.x * fade;
        offset.y = Math.abs(offset.y * fade) < 0.002 ? 0 : offset.y * fade;
      }
      if (shown && shown.level !== view.level) offsets = [];
      else if (revision !== undefined && nextRevision !== revision && shown)
        for (const [slot, rider] of view.riders.entries()) {
          const was = shown.riders[slot];
          if (slot === local || !was || was.id !== rider.id) continue;
          const dx = was.bike.x - rider.bike.x,
            dy = was.bike.y - rider.bike.y;
          offsets[slot] =
            Math.hypot(dx, dy) > TELEPORT ? { x: 0, y: 0 } : { x: dx, y: dy };
        }
      revision = nextRevision;
      const moved = offsets.some((offset) => offset && (offset.x || offset.y));
      const result: WorldView = moved
        ? {
            ...view,
            riders: view.riders.map((rider, slot) => {
              const offset = offsets[slot];
              return slot === local || !offset || (!offset.x && !offset.y)
                ? rider
                : { ...rider, bike: shiftBike(rider.bike, offset.x, offset.y) };
            }),
          }
        : view;
      shown = result;
      return result;
    },
  };
}
