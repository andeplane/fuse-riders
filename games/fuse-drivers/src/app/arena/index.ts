import type { FuseDriversView } from "../../game/game.js";
import type { ArenaEngine, ArenaEngineOptions } from "./scene.js";

export type { ArenaFrame } from "./frame.js";
export { renderSnapshot, renderTruck, type TruckPose } from "./interpolate.js";

export interface MountArenaOptions extends ArenaEngineOptions {
  /** Called once the arena has drawn its first frame's worth of setup and is live. */
  onReady?: () => void;
  /** Phaser failed to download or boot. The race keeps running; only this device's picture is missing. */
  onError?: (error: unknown) => void;
}

export interface MountedArena {
  /**
   * Draw one frame. `view` is the newest view the page has, and `alpha` is how far from the view handed in
   * before it to this one, 0 to 1. Nothing else is read: outcomes come from the view, never from an event,
   * because a rollback corrects history without emitting the events again.
   */
  render(view: FuseDriversView, alpha: number, selfId?: string): void;
  destroy(): void;
}

/**
 * Put the racing arena on a canvas.
 *
 * Phaser is imported lazily, so the lobby boots without downloading it, and it is handed the canvas rather
 * than a parent: the page owns the DOM node and the frame loop, and calls `render` once per animation frame.
 * Until the download and boot finish, `render` keeps only the newest frame and draws it as soon as it can.
 */
export function mountArena(
  canvas: HTMLCanvasElement,
  options: MountArenaOptions = {},
): MountedArena {
  let engine: ArenaEngine | undefined;
  let disposed = false;
  let latest:
    | { view: FuseDriversView; alpha: number; selfId: string | undefined }
    | undefined;
  const paint = (): void => {
    if (!engine || !latest || disposed) return;
    engine.render(latest.view, latest.alpha, latest.selfId);
  };
  const fail = (error: unknown): void => {
    if (disposed) return;
    options.onError?.(error);
  };
  void import("./scene.js")
    .then(async ({ createArena }) => {
      if (disposed) return;
      const started = createArena(canvas, options);
      engine = started;
      await started.ready;
      if (disposed) {
        started.destroy();
        return;
      }
      options.onReady?.();
      paint();
    })
    .catch(fail);

  return {
    render(view, alpha, selfId) {
      if (disposed) return;
      latest = { view, alpha, selfId };
      paint();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      latest = undefined;
      engine?.destroy();
      engine = undefined;
    },
  };
}
