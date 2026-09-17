import {
  aimGesture,
  cancelGesture,
  pressGesture,
  releaseGesture,
  type GestureControls,
} from "./bomb-gesture.js";
import type { AimPoint, BombAction, BombActionCommand } from "./primitives.js";

export const MAX_PENDING_BOMB_ACTIONS = 8;

/**
 * The gesture core for a caller that has a device's frames and no log: it numbers the gestures itself and queues the
 * commands until the next tick drains them. Frame for frame it yields what an online replica folds from the entries
 * the same device would log (`tests/bomb-input-differential.test.ts` holds it to that): a press is always a new
 * gesture, so one over a held gesture is `cancel` then `press`; a release or a cancel with nothing held is nothing;
 * an aim is kept only while a gesture is held, and the aim a release frame carries goes with that release.
 *
 * It was the LAN server's per-connection buffer and had drifted from the fold. Nothing in the app uses it now; tests
 * and tools that script a rider by frames do.
 */
export class BombInputBuffer {
  private pending: BombActionCommand[] = [];
  private readonly controls: GestureControls = {
    activeGesture: 0,
    latestGesture: 0,
  };

  /** One frame from the device: the button's edge in it, if any, and where the rider is aiming. */
  accept(action?: BombAction, aim?: AimPoint): void {
    const { controls } = this;
    if (action === "press")
      pressGesture(controls, controls.latestGesture + 1, this.pending);
    if (aim && controls.activeGesture && action !== "release")
      aimGesture(controls, { ...aim });
    if (action === "release" && controls.activeGesture)
      releaseGesture(
        controls,
        controls.activeGesture,
        aim && { ...aim },
        this.pending,
      );
    if (action === "cancel") this.cancel();
    this.bound();
  }

  /** The device lost the button without an edge (focus, visibility): whatever is held is abandoned. */
  cancel(): void {
    if (this.controls.activeGesture)
      cancelGesture(this.controls, this.controls.activeGesture, this.pending);
  }

  drain(): BombAction[] {
    return this.drainCommands().map((command) => command.action);
  }

  drainCommands(): BombActionCommand[] {
    const actions = this.pending;
    this.pending = [];
    return actions;
  }

  /**
   * A queue nobody drains must not grow. Past the bound the tick's commands are dropped for a single `cancel` and the
   * held gesture is abandoned: the rider loses a charge rather than launching some arbitrary part of what was queued.
   * The log has no such rule because a stream bounds its own entries; the differential test stays under the bound.
   */
  private bound(): void {
    if (this.pending.length <= MAX_PENDING_BOMB_ACTIONS) return;
    this.controls.activeGesture = 0;
    this.controls.aim = undefined;
    this.pending = [{ action: "cancel" }];
  }
}
