/**
 * Which sheet and frame a unit shows. The view says what a unit is doing on this step (grounded, moving, flapped,
 * diving, carrying); the only memory the renderer adds is how long ago each unit last flapped and which way it is
 * moving vertically.
 */
import { TICK_HZ, type UnitView } from "../engine/index.js";
import {
  animationFrame,
  frameIndex,
  teamName,
  type ArtManifest,
  type SheetDef,
} from "./manifest.js";

/** Steps each frame of the wing beat is held after a flap; four frames make one beat. */
export const FLAP_FRAME_STEPS = 2;
/** Invulnerable units show their white silhouette on alternate beats of this many steps. */
export const FLASH_BEAT_STEPS = 4;

export interface PoseContext {
  /** The display frame's time in steps, fractional. */
  readonly time: number;
  /** Change of `y` per step: negative while rising. */
  readonly dy: number;
  /** Steps since the unit last flapped or jumped; Infinity when it has not. */
  readonly sinceFlap: number;
  /** A Worker standing in a gate, transforming. */
  readonly inGate: boolean;
}

export interface Pose {
  /** Manifest id of the sheet to draw. */
  readonly sheet: string;
  readonly frame: number;
  /** The name of the animation chosen, for tests and the debug hook. */
  readonly animation: string;
  /** Drawn as the white silhouette this frame. */
  readonly flash: boolean;
}

/** Manifest id of a unit's team sheet: `speed-warrior-pink`, `queen-cyan`. Queens have no speed form. */
export function unitSheet(unit: UnitView): string {
  const speed = unit.speed && unit.kind !== "queen" ? "speed-" : "";
  return `${speed}${unit.kind}-${teamName(unit.team)}`;
}

export const flashing = (unit: UnitView, time: number): boolean =>
  unit.invulnerable && Math.floor(time / FLASH_BEAT_STEPS) % 2 === 0;

function sheetOf(manifest: ArtManifest, id: string): SheetDef {
  const def = manifest.assets[id];
  if (!def) throw new Error(`no sheet ${id}`);
  return def;
}

function workerAnimation(unit: UnitView, context: PoseContext): string {
  if (unit.eaten) return "run";
  if (unit.riding) return "idle";
  if (!unit.grounded) return context.dy < 0 ? "jump" : "fall";
  return unit.moving ? "run" : "idle";
}

function wingedAnimation(unit: UnitView, context: PoseContext): string {
  if (unit.grounded) return unit.moving ? "walk" : "idle";
  if (unit.diving) return "dive";
  return context.sinceFlap < FLAP_FRAME_STEPS * 4 ? "fly" : "glide";
}

export function unitPose(
  manifest: ArtManifest,
  unit: UnitView,
  context: PoseContext,
): Pose {
  const flash = flashing(unit, context.time);
  const seconds = context.time / TICK_HZ;
  if (unit.kind === "worker" && context.inGate) {
    // The manifest's note: loop frames 1 to 3 while the Worker waits in the gate.
    const def = sheetOf(manifest, `transform-${teamName(unit.team)}`);
    return {
      sheet: `transform-${teamName(unit.team)}`,
      frame: 1 + (Math.floor(seconds * def.fps) % 3),
      animation: "transform",
      flash: false,
    };
  }
  const id = unitSheet(unit);
  const def = sheetOf(manifest, id);
  const sheet = flash && def.flash ? def.flash : id;
  if (unit.kind === "worker") {
    const animation = workerAnimation(unit, context);
    // A Worker in the snail's mouth runs on the spot twice as fast; a speed Worker's legs keep up with it.
    const rate = unit.eaten ? 2 : unit.speed && animation === "run" ? 1.35 : 1;
    const frame = animationFrame(def, animation, seconds * rate);
    const carried = unit.carrying
      ? Object.entries(def.frames).find(
          ([name, index]) => index === frame && def.frames[`${name}Carry`],
        )
      : undefined;
    return {
      sheet,
      frame: carried ? frameIndex(def, `${carried[0]}Carry`) : frame,
      animation: unit.carrying ? `${animation}Carry` : animation,
      flash,
    };
  }
  const animation = wingedAnimation(unit, context);
  if (animation === "fly") {
    // The beat restarts on every flap, so the wings follow the button and not a clock.
    const beat = def.animations.fly?.frames ?? [];
    const at = Math.min(
      beat.length - 1,
      Math.floor(Math.max(0, context.sinceFlap) / FLAP_FRAME_STEPS),
    );
    return {
      sheet,
      frame: frameIndex(def, beat[at] ?? "flapMid"),
      animation,
      flash,
    };
  }
  const known = def.animations[animation] ? animation : "glide";
  return {
    sheet,
    frame: animationFrame(def, known, seconds),
    animation: known,
    flash,
  };
}

/** Per-slot memory of the last flap, fed once per simulation step and tolerant of a step fed again. */
export class FlapClock {
  private readonly last: number[] = [];

  note(slot: number, step: number): void {
    this.last[slot] = step;
  }

  /** Forgets flaps from the future: a rollback or a new round starts the count again. */
  rewind(step: number): void {
    for (let slot = 0; slot < this.last.length; slot += 1)
      if ((this.last[slot] ?? -Infinity) > step) this.last[slot] = -Infinity;
  }

  since(slot: number, time: number): number {
    const at = this.last[slot];
    return at === undefined ? Infinity : Math.max(0, time - at);
  }
}
