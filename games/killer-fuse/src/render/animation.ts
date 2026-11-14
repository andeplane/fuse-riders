/**
 * Which sheet and frame a unit shows. The view says what a unit is doing on this step (grounded, moving, flapped,
 * diving, carrying); the only memory the renderer adds is how long ago each unit last flapped and which way it is
 * moving vertically.
 */
import {
  FLAP_IMPULSE,
  FLY_GRAVITY,
  FLY_TERMINAL,
  S,
  TICK_HZ,
  type RoundView,
  type UnitView,
} from "../engine/index.js";
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
/**
 * Sinking slower than this many pixels a step, or rising, means the wings are working: gravity alone passes it within
 * a few steps. It keeps the wings beating when the page feeds only every third step and most flaps are never seen.
 */
export const WINGS_DY = 1;
/**
 * Falling this many pixels a step slower than gravity alone would have it is a flap: half of one press. Averaged over
 * a three-step tick, a press shows as a third, two thirds or all of itself, so half counts each press once.
 */
export const FLAP_SLOWING = FLAP_IMPULSE / S / 2;
/** A move of more than this many pixels a step is a respawn or a wrap, not flight. */
export const FLAP_JUMP = 8;
/** A Warrior falling at least this many pixels a step, wings still, tips into its dive pose. */
export const PLUNGE_DY = 2;

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
  if (context.sinceFlap < FLAP_FRAME_STEPS * 4 || context.dy < WINGS_DY)
    return "fly";
  // Warriors cannot dive, but one dropping at full speed reads better nose-down than gliding flat.
  return unit.kind === "warrior" && context.dy >= PLUNGE_DY ? "dive" : "glide";
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
    // With no flap seen lately the unit is still holding itself up, so the beat runs on the clock.
    const seen = context.sinceFlap < FLAP_FRAME_STEPS * 4;
    const at =
      Math.floor(
        Math.max(0, seen ? context.sinceFlap : context.time) / FLAP_FRAME_STEPS,
      ) % Math.max(1, beat.length);
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

/**
 * Flaps read from movement, for a page that feeds one view per network tick: a flying unit that falls slower than
 * gravity would have it between two fed views flapped in between, whatever the last step's `flapped` says.
 * `lastDy` is each slot's speed over the previous pair; the result carries the new speeds and who flapped.
 */
export function velocityFlaps(
  before: RoundView,
  after: RoundView,
  lastDy: readonly (number | undefined)[],
): { slots: number[]; dy: (number | undefined)[] } {
  const steps = after.step - before.step;
  const slots: number[] = [];
  const dy = after.units.map((unit, slot) => {
    const was = before.units[slot];
    if (steps <= 0 || !was || was.dead || unit.dead) return undefined;
    if (was.grounded || unit.grounded || unit.kind === "worker")
      return undefined;
    if (Math.abs(unit.y - was.y) > FLAP_JUMP * steps) return undefined;
    const speed = (unit.y - was.y) / steps;
    const last = lastDy[slot];
    const falling =
      last === undefined
        ? speed
        : Math.min(FLY_TERMINAL / S, last + (FLY_GRAVITY / S) * steps);
    // A dive that ends slows the fall too; a flap already seen on the earlier view explains the change.
    if (
      speed < falling - FLAP_SLOWING &&
      !was.diving &&
      !unit.diving &&
      !was.flapped &&
      !unit.flapped
    )
      slots.push(slot);
    return speed;
  });
  return { slots, dy };
}
