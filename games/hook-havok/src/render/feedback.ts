import type { WorldView } from "../engine/view.js";
import { idleBreath } from "./showcase-timeline.js";
export type Cue =
  | "jump"
  | "land"
  | "fire"
  | "attach"
  | "release"
  | "respawn"
  | "impact"
  | "pop";
export interface Burst {
  kind: Cue;
  x: number;
  y: number;
  at: number;
}
/** Cosmetic history only: never feeds inputs or changes the simulation. */
export class Feedback {
  private previous?: WorldView;
  private through = -1;
  private bursts: Burst[] = [];
  reset(): void {
    this.previous = undefined;
    this.through = -1;
    this.bursts = [];
  }
  update(view: WorldView, ms: number): Cue[] {
    this.bursts = this.bursts.filter((b) => ms - b.at < 400);
    if (view.tick <= this.through) return [];
    const old = this.previous;
    this.previous = view;
    this.through = view.tick;
    if (!old || view.tick - old.tick > 12) return [];
    const cues: Cue[] = [];
    if (
      old.experiment === view.experiment &&
      view.combat.hits > old.combat.hits &&
      view.combat.impact.tick > old.tick
    )
      cues.push(view.experiment === "ball" ? "pop" : "impact");
    if (old.respawn && !view.respawn) cues.push("respawn");
    else if (
      !view.respawn &&
      Math.hypot(view.x - old.x, view.feet - old.feet) < 100
    ) {
      if (old.grounded && !view.grounded && view.vy < 0) cues.push("jump");
      if (!old.grounded && view.grounded && old.vy > 60) cues.push("land");
      if (
        old.hook.phase === "ready" &&
        (view.hook.phase === "flying" || view.hook.phase === "attached")
      )
        cues.push("fire");
      if (old.hook.phase !== "attached" && view.hook.phase === "attached")
        cues.push("attach");
      if (old.hook.phase === "attached" && view.hook.phase !== "attached")
        cues.push("release");
    }
    for (const kind of cues)
      this.bursts.push({
        kind,
        x:
          kind === "impact" || kind === "pop"
            ? view.combat.impact.x
            : kind === "attach"
              ? view.hook.x
              : view.x,
        y:
          kind === "impact" || kind === "pop"
            ? view.combat.impact.y
            : kind === "attach"
              ? view.hook.y
              : view.feet,
        at: ms,
      });
    if (view.hit && view.hit.tick > old.tick) {
      cues.push("impact");
      this.bursts.push({
        kind: "impact",
        x: view.hit.x,
        y: view.hit.y,
        at: ms,
      });
    }
    this.bursts = this.bursts.slice(-12);
    return cues;
  }
  active(): readonly Burst[] {
    return this.bursts;
  }
  pose(view: WorldView, ms: number, reduced: boolean) {
    const landing = [...this.bursts].reverse().find((b) => b.kind === "land");
    const fired = [...this.bursts].reverse().find((b) => b.kind === "fire");
    const compression =
      !reduced && landing ? Math.max(0, 1 - (ms - landing.at) / 180) : 0;
    const recoil =
      !reduced && fired ? Math.max(0, 1 - (ms - fired.at) / 100) : 0;
    const moving = view.grounded && Math.abs(view.vx) > 20;
    const state = view.respawn
      ? "respawn"
      : compression > 0
        ? "land"
        : recoil > 0
          ? "fire"
          : view.hook.phase === "attached"
            ? "pull"
            : !view.grounded
              ? view.vy < 0
                ? "rise"
                : "fall"
              : moving
                ? "run"
                : "idle";
    const frame = moving
      ? 2 + (Math.floor(ms / Math.max(65, 125 - Math.abs(view.vx) / 10)) % 4)
      : state === "rise" || state === "pull"
        ? 3
        : state === "fall"
          ? 4
          : 0;
    const stretch = reduced
      ? 0
      : compression
        ? -0.12 * compression
        : !view.grounded && view.vy < 0
          ? 0.035
          : 0;
    return {
      state,
      frame,
      scaleX: 1 - stretch * 0.45,
      scaleY: state === "idle" && !reduced ? idleBreath(ms) : 1 + stretch,
      rotation: reduced
        ? 0
        : state === "pull"
          ? view.facing * 0.065
          : -view.facing * recoil * 0.055,
    };
  }
}
