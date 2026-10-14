import type { WorldView } from "../../engine/view.js";
import { wrapCoordinate, wrapDelta } from "../../engine/view-kit.js";

export interface RiderPose {
  x: number;
  y: number;
  angle: number;
}
export type RiderPoses = ReadonlyMap<string, RiderPose>;
export const CORRECTION_MS = 120;
const MAX_GAP_MS = 200;
const MAX_DISTANCE = 120;
const angleDelta = (value: number) =>
  Math.atan2(Math.sin(value), Math.cos(value));
interface Offset {
  x: number;
  y: number;
  angle: number;
  at: number;
}

/** Short-lived portrait/heading offsets only. Trails, weapons, collisions and the local rider keep their supplied poses. */
export class RiderReconciler {
  private previous?: {
    view: WorldView;
    now: number;
    scope: string;
    revision: number;
    poses: RiderPoses;
  };
  private readonly offsets = new Map<string, Offset>();
  reset(): void {
    this.previous = undefined;
    this.offsets.clear();
  }
  sample(
    view: WorldView,
    now: number,
    scope: string,
    revision: number,
    localId?: string,
  ): RiderPoses {
    const previous = this.previous;
    const continuous =
      previous !== undefined &&
      previous.scope === scope &&
      previous.view.round === view.round &&
      previous.view.phase === view.phase &&
      view.phase === "playing" &&
      (view.tick >= previous.view.tick ||
        (revision !== previous.revision &&
          previous.view.tick - view.tick <= 1)) &&
      now >= previous.now &&
      now - previous.now <= MAX_GAP_MS &&
      view.width === previous.view.width &&
      view.height === previous.view.height &&
      view.openEdges === previous.view.openEdges;
    if (!continuous) this.offsets.clear();
    const poses = new Map<string, RiderPose>();
    for (const rider of view.players) {
      const before = continuous
        ? previous.view.players.find((p) => p.id === rider.id)
        : undefined;
      const stable =
        before?.alive &&
        rider.alive &&
        rider.id !== localId &&
        before.avatarId === rider.avatarId &&
        before.color === rider.color &&
        before.portalCooldownUntilTick === rider.portalCooldownUntilTick &&
        before.gunAim === undefined &&
        rider.gunAim === undefined &&
        !before.gunArmed &&
        !rider.gunArmed &&
        before.bombChargeStartedTick === undefined &&
        rider.bombChargeStartedTick === undefined;
      if (!stable) this.offsets.delete(rider.id);
      else if (revision !== previous!.revision) {
        const shown = previous!.poses.get(rider.id) ?? before;
        const dx = shown.x - rider.x,
          dy = shown.y - rider.y;
        const x = view.openEdges ? wrapDelta(dx, view.width) : dx;
        const y = view.openEdges ? wrapDelta(dy, view.height) : dy;
        if (Math.hypot(x, y) <= MAX_DISTANCE)
          this.offsets.set(rider.id, {
            x,
            y,
            angle: angleDelta(shown.angle - rider.angle),
            at: now,
          });
        else this.offsets.delete(rider.id);
      }
      const offset = this.offsets.get(rider.id);
      const remaining = offset
        ? Math.max(0, 1 - (now - offset.at) / CORRECTION_MS)
        : 0;
      if (offset && remaining > 0) {
        const x = rider.x + offset.x * remaining,
          y = rider.y + offset.y * remaining;
        poses.set(rider.id, {
          x: view.openEdges ? wrapCoordinate(x, view.width) : x,
          y: view.openEdges ? wrapCoordinate(y, view.height) : y,
          angle: rider.angle + offset.angle * remaining,
        });
      } else {
        this.offsets.delete(rider.id);
        poses.set(rider.id, rider);
      }
    }
    for (const id of this.offsets.keys())
      if (!poses.has(id)) this.offsets.delete(id);
    this.previous = { view, now, scope, revision, poses };
    return poses;
  }
}
