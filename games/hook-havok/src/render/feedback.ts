import type { WorldView } from "../engine/view.js";
import { idleBreath } from "./showcase-timeline.js";
import { ballColor } from "./balls.js";
export type Cue =
  | "power"
  | "jump"
  | "land"
  | "fire"
  | "attach"
  | "release"
  | "respawn"
  | "impact"
  | "pop";
export interface Burst {
  kind: Cue | "vanish" | "air-jump";
  x: number;
  y: number;
  at: number;
  direction?: number;
  target?: string;
  color?: number;
}
/** Cosmetic history only: never feeds inputs or changes the simulation. */
export class Feedback {
  private previous?: WorldView;
  private through = -1;
  private bursts: Burst[] = [];
  private subject?: string;
  private poseAt?: number;
  private stride = 0;
  private running = false;
  reset(): void {
    this.previous = undefined;
    this.through = -1;
    this.bursts = [];
    this.subject = undefined;
    this.poseAt = undefined;
    this.stride = 0;
    this.running = false;
  }
  update(view: WorldView, ms: number): Cue[] {
    const subject = view.localId ?? view.keepers[0]?.id;
    if (this.previous && subject !== this.subject) this.reset();
    this.subject = subject;
    this.bursts = this.bursts.filter((b) => ms - b.at < 400);
    if (view.tick <= this.through) return [];
    const old = this.previous;
    this.previous = view;
    this.through = view.tick;
    if (!old) return [];
    if (view.tick - old.tick > 12) {
      this.bursts = [];
      this.stride = 0;
      this.running = false;
      this.poseAt = ms;
      return [];
    }
    const wasIn = old.contest.entries.find((entry) => entry.id === subject);
    const nowOut = view.contest.entries.find((entry) => entry.id === subject);
    if (view.deaths > old.deaths || (wasIn && !wasIn.out && nowOut?.out))
      this.bursts.push({
        kind: "vanish",
        x: old.x,
        y: Math.min(870, old.feet),
        at: ms,
      });
    const cues: Cue[] = [];
    if (view.pickupEvents.some((e) => e.by === subject && e.tick > old.tick))
      cues.push("power");
    if (
      old.experiment === view.experiment &&
      view.combat.hits > old.combat.hits &&
      view.combat.impact.tick > old.tick
    )
      cues.push(view.experiment === "target" ? "impact" : "pop");
    if (old.respawn && !view.respawn) cues.push("respawn");
    else if (
      !view.respawn &&
      Math.hypot(view.x - old.x, view.feet - old.feet) < 100
    ) {
      if (old.grounded && !view.grounded && view.vy < 0) cues.push("jump");
      if (old.airJump && !view.airJump && view.vy < 0) {
        cues.push("jump");
        this.bursts.push({ kind: "air-jump", x: view.x, y: view.feet, at: ms });
      }
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
        ...(kind === "pop"
          ? {
              color: ballColor(
                old.combat.balls.find(
                  (b) => !view.combat.balls.some((n) => n.id === b.id),
                )?.id ?? 1,
              ),
            }
          : {}),
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
      const victim = view.keepers.find(
        (keeper) => keeper.id === view.hit!.target,
      );
      this.bursts.push({
        kind: "impact",
        x: view.hit.x,
        y: view.hit.y,
        at: ms,
        target: view.hit.target,
        direction: Math.atan2(
          victim?.body.vy ?? 0,
          victim?.body.vx || view.facing,
        ),
      });
    }
    this.bursts = this.bursts.slice(-12);
    return cues;
  }
  active(): readonly Burst[] {
    return this.bursts;
  }
  pose(view: WorldView, ms: number, reduced: boolean) {
    let landing: Burst | undefined,
      fired: Burst | undefined,
      jumped: Burst | undefined,
      released: Burst | undefined,
      arrived: Burst | undefined,
      struck: Burst | undefined;
    // Keep the newest cue of each kind without allocating reversed copies per keeper.
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]!;
      switch (burst.kind) {
        case "land":
          landing ??= burst;
          break;
        case "fire":
          fired ??= burst;
          break;
        case "jump":
          jumped ??= burst;
          break;
        case "release":
          released ??= burst;
          break;
        case "respawn":
          arrived ??= burst;
          break;
        case "impact":
          if (burst.target !== undefined && burst.target === this.subject)
            struck ??= burst;
          break;
      }
    }
    const compression =
      !reduced && landing ? Math.max(0, 1 - (ms - landing.at) / 180) : 0;
    const firing = fired ? Math.max(0, 1 - (ms - fired.at) / 100) : 0;
    const recoil = reduced ? 0 : firing;
    const entry = arrived ? Math.max(0, 1 - (ms - arrived.at) / 260) : 0;
    const hit = struck ? Math.max(0, 1 - (ms - struck.at) / 200) : 0;
    const release = released ? Math.max(0, 1 - (ms - released.at) / 160) : 0;
    const takeoff = jumped ? Math.max(0, 1 - (ms - jumped.at) / 130) : 0;
    const moving = view.grounded && Math.abs(view.vx) > 20;
    const state = view.respawn
      ? "respawn"
      : hit > 0
        ? "hit"
        : firing > 0
          ? "fire"
          : view.hook.phase === "attached"
            ? "pull"
            : entry > 0
              ? "arrive"
              : compression > 0
                ? "land"
                : !view.grounded
                  ? view.vy < 0
                    ? "rise"
                    : "fall"
                  : moving
                    ? "run"
                    : "idle";
    // Integrate only presentation time; idle/action transitions restart at contact.
    const delta = Math.max(0, Math.min(50, ms - (this.poseAt ?? ms)));
    this.poseAt = ms;
    if (state === "run" && !reduced) {
      this.stride = this.running
        ? (this.stride + (Math.abs(view.vx) * delta) / 150000) % 1
        : 0;
      this.running = true;
    } else {
      this.stride = 0;
      this.running = false;
    }
    const frame =
      state === "fire"
        ? 7
        : state === "pull"
          ? 8
          : state === "rise"
            ? 5
            : state === "fall" || state === "hit"
              ? 6
              : state === "run"
                ? Math.floor(this.stride * 8)
                : 0;
    const stretch = reduced
      ? 0
      : hit
        ? -0.08 * hit
        : entry
          ? -0.12 * entry
          : compression && state === "land"
            ? -0.12 * compression
            : !view.grounded && view.vy < 0
              ? 0.035 + takeoff * 0.055
              : 0;
    return {
      state,
      frame,
      texture: state === "run" ? ("run" as const) : ("actor" as const),
      alpha: reduced ? 1 : 1 - entry * 0.35,
      scaleX: 1 - stretch * 0.45,
      scaleY: state === "idle" && !reduced ? idleBreath(ms) : 1 + stretch,
      rotation: reduced
        ? 0
        : hit
          ? Math.cos(struck!.direction ?? 0) * hit * 0.13
          : state === "pull"
            ? view.facing * 0.065
            : state === "run"
              ? Math.max(-0.045, Math.min(0.045, view.vx / 8000))
              : -view.facing * (recoil * 0.055 + release * 0.04),
    };
  }
}
