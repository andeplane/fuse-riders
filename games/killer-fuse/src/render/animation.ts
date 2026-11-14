/**
 * Which sheet and frame a unit shows. The view says what a unit is doing on this step (grounded, moving, flapped,
 * diving, carrying); the only memory the renderer adds is how long ago each unit last flapped and which way it is
 * moving vertically.
 */
import {
  FLAP_THRUST,
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

/**
 * Timings taken from the arcade original, in seconds. A press plays the whole wing beat once, fast: a tenth of a
 * second for a Queen, a little less for a Warrior. The wings are then held ready, and the falling pose only comes
 * `glide` after the last press.
 */
export const FLAP_SECONDS = { queen: 0.1, warrior: 0.08, glide: 0.27 } as const;
/** Steps one wing beat takes for a kind of unit, and steps after a flap at which the falling pose starts. */
export const beatSteps = (kind: UnitView["kind"]): number =>
  (kind === "queen" ? FLAP_SECONDS.queen : FLAP_SECONDS.warrior) * TICK_HZ;
export const GLIDE_STEPS = FLAP_SECONDS.glide * TICK_HZ;
/** An invulnerable unit blinks white on a cycle of a sixth of a second: this many steps on, as many off. */
export const FLASH_BEAT_STEPS = Math.round((0.167 * TICK_HZ) / 2);
/** A landing squashes a body for this long, down to this share of its height at full falling speed. */
export const LAND_SECONDS = 0.15;
export const LAND_HEIGHT = { worker: 0.75, warrior: 0.8, queen: 0.8 } as const;
/** A Worker's jump stretches it for this long, from this shape back to its own. */
export const JUMP_SECONDS = 0.2;
export const JUMP_SHAPE = { w: 0.8, h: 1.2 } as const;
/**
 * Sinking slower than this many pixels a step, or rising, means the wings are working: gravity alone passes it within
 * a few steps. It keeps the wings beating when the page feeds only every third step and most flaps are never seen.
 */
export const WINGS_DY = 1;
/**
 * A flap pushes up for a while rather than at once, so between two fed views it shows as a fall that gathers less
 * speed than gravity gives it. This much less, in pixels a step each step, is one flap pushing: half its thrust, so
 * the lighter gravity after a take-off does not count as one.
 */
export const FLAP_SLOWING = FLAP_THRUST / S / 2;
/** A move of more than this many pixels a step is a respawn or a wrap, not flight. */
export const FLAP_JUMP = 8;

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
  if (context.sinceFlap < GLIDE_STEPS || context.dy < WINGS_DY) return "fly";
  return "glide";
}

export function unitPose(
  manifest: ArtManifest,
  unit: UnitView,
  context: PoseContext,
): Pose {
  const flash = flashing(unit, context.time);
  const seconds = context.time / TICK_HZ;
  if (unit.kind === "worker" && context.inGate) {
    // Standing between the pillars with empty hands: the berry it paid lies on top of the gate.
    const id = unitSheet({ ...unit, speed: false });
    return {
      sheet: id,
      frame: animationFrame(sheetOf(manifest, id), "idle", seconds),
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
    // The beat plays once from every flap, so the wings follow the button and not a clock; between presses they
    // are held raised, on the beat's first frame.
    const beat = def.animations.fly?.frames ?? [];
    const length = Math.max(1, beat.length);
    const steps = beatSteps(unit.kind);
    // With no flap seen lately the unit is still holding itself up, so the beat runs on the clock.
    const seen = context.sinceFlap < GLIDE_STEPS;
    const since = Math.max(0, seen ? context.sinceFlap : context.time);
    const at =
      seen && since >= steps
        ? 0
        : Math.floor((since / steps) * length) % length;
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

/** What the renderer remembers of each slot's flight between fed views: its speed and the flaps seen pushing. */
export interface FlightTrace {
  readonly dy: readonly (number | undefined)[];
  readonly lift: readonly (number | undefined)[];
}

export const NO_FLIGHT: FlightTrace = { dy: [], lift: [] };

/**
 * Flaps read from movement, for a page that feeds one view per network tick: most presses fall on steps never shown.
 * Each press pushes up for FLAP_STEPS steps, so a flying unit that gathers less falling speed than gravity alone gives
 * has flaps pushing; one more of them than over the previous pair of views is a new press. `trace` is what the last
 * pair left; the result carries the new one and who flapped.
 */
export function velocityFlaps(
  before: RoundView,
  after: RoundView,
  trace: FlightTrace,
): { slots: number[]; trace: FlightTrace } {
  const steps = after.step - before.step;
  const slots: number[] = [];
  const dy: (number | undefined)[] = [];
  const lift: (number | undefined)[] = [];
  after.units.forEach((unit, slot) => {
    const was = before.units[slot];
    if (
      steps <= 0 ||
      !was ||
      was.dead ||
      unit.dead ||
      was.grounded ||
      unit.grounded ||
      unit.kind === "worker" ||
      Math.abs(unit.y - was.y) > FLAP_JUMP * steps
    )
      return;
    const speed = (unit.y - was.y) / steps;
    dy[slot] = speed;
    const last = trace.dy[slot];
    if (last === undefined) return;
    const falling = Math.min(
      FLY_TERMINAL / S,
      last + (FLY_GRAVITY / S) * steps,
    );
    const pushing = Math.max(
      0,
      Math.round((falling - speed) / steps / (FLAP_SLOWING * 2)),
    );
    lift[slot] = pushing;
    // A dive that ends slows the fall too; a flap already seen on either view explains the change.
    if (
      pushing > (trace.lift[slot] ?? 0) &&
      !was.diving &&
      !unit.diving &&
      !was.flapped &&
      !unit.flapped
    )
      slots.push(slot);
  });
  return { slots, trace: { dy, lift } };
}

/** Slots whose dive ended between two views while still in the air: they go straight back to beating wings. */
export function diveEnds(before: RoundView, after: RoundView): number[] {
  return after.units
    .filter((unit) => {
      const was = before.units[unit.slot];
      return (
        was !== undefined &&
        was.diving &&
        !was.dead &&
        !unit.diving &&
        !unit.dead &&
        !unit.grounded
      );
    })
    .map((unit) => unit.slot);
}

/** A unit that came down onto something between two views, and how hard: 0 to 1 of the fastest fall. */
export function landings(
  before: RoundView,
  after: RoundView,
): { slot: number; strength: number }[] {
  const steps = after.step - before.step;
  if (steps <= 0) return [];
  return after.units.flatMap((unit) => {
    const was = before.units[unit.slot];
    if (!was || was.dead || unit.dead || was.grounded || !unit.grounded)
      return [];
    const fall = (unit.y - was.y) / steps;
    if (fall <= 0 || fall > FLAP_JUMP) return [];
    return [
      { slot: unit.slot, strength: Math.min(1, fall / (FLY_TERMINAL / S)) },
    ];
  });
}

export interface BodyShape {
  readonly w: number;
  readonly h: number;
}

const WHOLE: BodyShape = { w: 1, h: 1 };

/**
 * How a body is stretched about its feet: squashed just after a landing (`sinceLand` seconds ago, as hard as
 * `strength`), and a Worker drawn thin and tall just after it jumps. Both ease back to the unit's own shape.
 */
export function bodyShape(
  kind: UnitView["kind"],
  sinceLand: number,
  strength: number,
  sinceJump: number,
): BodyShape {
  if (sinceLand >= 0 && sinceLand < LAND_SECONDS) {
    const left =
      (1 - sinceLand / LAND_SECONDS) * Math.max(0, Math.min(1, strength));
    const h = 1 - (1 - LAND_HEIGHT[kind]) * left;
    return { w: 1 + (1 - h) / 2, h };
  }
  if (kind === "worker" && sinceJump >= 0 && sinceJump < JUMP_SECONDS) {
    const left = 1 - sinceJump / JUMP_SECONDS;
    return {
      w: 1 - (1 - JUMP_SHAPE.w) * left,
      h: 1 + (JUMP_SHAPE.h - 1) * left,
    };
  }
  return WHOLE;
}
