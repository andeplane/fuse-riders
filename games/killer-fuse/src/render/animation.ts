/**
 * Which sheet and frame a unit shows. The view says what a unit is doing on this step (grounded, moving, flapped,
 * diving, carrying); the only memory the renderer adds is how long ago each unit last flapped and which way it is
 * moving vertically.
 */
import type { RoundView, UnitView, ViewRules } from "../engine/view.js";
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
export const beatSteps = (kind: UnitView["kind"], rules: ViewRules): number =>
  (kind === "queen" ? FLAP_SECONDS.queen : FLAP_SECONDS.warrior) * rules.tickHz;
export const glideSteps = (rules: ViewRules): number =>
  FLAP_SECONDS.glide * rules.tickHz;
/** An invulnerable unit blinks white on a cycle of a sixth of a second: this many steps on, as many off. */
export const flashBeatSteps = (rules: ViewRules): number =>
  Math.round((0.167 * rules.tickHz) / 2);
/** A stunned unit blinks white much faster: this many steps on, as many off. */
export const STUN_BEAT_STEPS = 2;
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
export const flapSlowing = (rules: ViewRules): number => rules.flapThrust / 2;
/** A move of more than this many pixels a step is a respawn or a wrap, not flight. */
export const FLAP_JUMP = 8;

export interface PoseContext {
  /** The view's rule values: the steps in a second, and the flight the poses read. */
  readonly rules: ViewRules;
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

export const flashing = (
  unit: UnitView,
  time: number,
  rules: ViewRules,
): boolean =>
  unit.stunned
    ? Math.floor(time / STUN_BEAT_STEPS) % 2 === 0
    : unit.invulnerable && Math.floor(time / flashBeatSteps(rules)) % 2 === 0;

/**
 * How many pixels a dashing unit's sprite is raised over its feet. The engine lifts a dashing unit's movement box
 * (a Warrior tucks its legs, a Queen lies flat at chest height), so on the ground its feet read that far under the
 * floor. The sprite is raised until the lowest painted row of its pose, `gap` pixels over the anchor, sits on the
 * bottom of that box: it then skims the floor in a ground dash and its blade is level with the engine's in the air.
 */
export function dashLift(
  unit: UnitView,
  gap: number,
  rules: ViewRules,
): number {
  if (!unit.dashing || unit.kind === "worker") return 0;
  return Math.max(0, rules.dashLift[unit.kind] - gap);
}

/**
 * How far a diving Queen's blade must be drawn on below the painted one, whose tip is `painted` pixels under her
 * feet, to end where the engine's does (`rules.diveTip`). Nothing when the art is within a pixel of it.
 */
export function diveReach(painted: number, rules: ViewRules): number {
  const missing = Math.round(rules.diveTip - painted);
  return missing > 1 ? missing : 0;
}

export type Sword = "none" | "ready" | "lethal" | "cooling";

/** What a fighter's sword is doing: it kills while lethal, and cannot be swung again until the cooldown is over. */
export function swordOf(unit: UnitView): Sword {
  if (unit.kind === "worker" || unit.dead) return "none";
  if (unit.attacking) return "lethal";
  return unit.attackStep > 0 ? "cooling" : "ready";
}

function sheetOf(manifest: ArtManifest, id: string): SheetDef {
  const def = manifest.assets[id];
  if (!def) throw new Error(`no sheet ${id}`);
  return def;
}

function workerAnimation(unit: UnitView, context: PoseContext): string {
  if (unit.eaten) return "run";
  // Sitting in a hive hole or riding: still.
  if (unit.riding || unit.depositing) return "idle";
  if (!unit.grounded) return context.dy < 0 ? "jump" : "fall";
  return unit.moving ? "run" : "idle";
}

function wingedAnimation(unit: UnitView, context: PoseContext): string {
  // The lunge for as long as the dash carries the unit or the sword can kill; a dive has its own pose.
  if (unit.dashing || (unit.attacking && !unit.diving)) return "attack";
  // Stunned in the air: wings limp.
  if (unit.stunned && !unit.grounded) return "glide";
  if (unit.grounded) return unit.moving ? "walk" : "idle";
  if (unit.diving) return "dive";
  if (context.sinceFlap < glideSteps(context.rules) || context.dy < WINGS_DY)
    return "fly";
  return "glide";
}

export function unitPose(
  manifest: ArtManifest,
  unit: UnitView,
  context: PoseContext,
): Pose {
  const flash = flashing(unit, context.time, context.rules);
  const seconds = context.time / context.rules.tickHz;
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
    const steps = beatSteps(unit.kind, context.rules);
    // With no flap seen lately the unit is still holding itself up, so the beat runs on the clock.
    const seen = context.sinceFlap < glideSteps(context.rules);
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
    const { rules } = after;
    const falling = Math.min(
      rules.flyTerminal,
      last + rules.flyGravity * steps,
    );
    const pushing = Math.max(
      0,
      Math.round((falling - speed) / steps / (flapSlowing(rules) * 2)),
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
      {
        slot: unit.slot,
        strength: Math.min(1, fall / after.rules.flyTerminal),
      },
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

/** Workers that left the ground upwards between two views: a jump, seen even when its own step was never shown. */
export function jumps(before: RoundView, after: RoundView): number[] {
  const steps = after.step - before.step;
  if (steps <= 0) return [];
  return after.units
    .filter((unit) => {
      const was = before.units[unit.slot];
      return (
        unit.kind === "worker" &&
        was !== undefined &&
        was.kind === "worker" &&
        was.grounded &&
        !unit.grounded &&
        !was.dead &&
        !unit.dead &&
        !unit.riding &&
        !unit.eaten &&
        !unit.depositing &&
        !was.depositing &&
        unit.y < was.y &&
        was.y - unit.y <= FLAP_JUMP * steps
      );
    })
    .map((unit) => unit.slot);
}

/** The doors slam shut over this many steps once the gate takes the berry. */
export const DOOR_SHUT_STEPS = 6;

export interface GateDoor {
  /** 0 to 1 through the offer: the gate has not taken the berry yet and the Worker may still walk out. */
  readonly offer: number;
  /** How far the doors are shut, 0 to 1: open through the offer, shut within a few steps of the lock. */
  readonly closed: number;
  /** 0 to 1 through the lock, the two seconds the Worker is held. */
  readonly lock: number;
}

/** What a gate's doors show at `progress` (0 to 1 of the whole stay, as the view gives it). */
export function gateDoor(progress: number, rules: ViewRules): GateDoor {
  const steps = Math.max(0, Math.min(1, progress)) * rules.gateSteps;
  if (steps < rules.gateOffer)
    return { offer: steps / rules.gateOffer, closed: 0, lock: 0 };
  const held = steps - rules.gateOffer;
  return {
    offer: 1,
    closed: Math.min(1, (held + 1) / DOOR_SHUT_STEPS),
    lock: Math.min(1, held / rules.gateLock),
  };
}

/** One line of the streak behind a dashing unit: `back` pixels behind its middle, `up` over its feet, `length` long. */
export interface StreakLine {
  readonly back: number;
  readonly up: number;
  readonly length: number;
}

/** The longest line of a dash's streak, in pixels. */
export const STREAK_LENGTH = 12;

/**
 * The speed lines behind a dashing unit whose painted body spans `low` to `high` pixels over its feet and reaches
 * `behind` pixels back from its middle: three of them over the body, long as the dash starts and short as it ends.
 * `lethal` is how many steps the dash lasts.
 */
export function dashStreak(
  attackStep: number,
  lethal: number,
  low: number,
  high: number,
  behind: number,
): StreakLine[] {
  if (attackStep < 1 || attackStep > lethal) return [];
  const left = 1 - (attackStep - 1) / lethal;
  // The middle line is the longest and the outer two start a little further back.
  return [0, 0.5, 1].map((share, index) => ({
    back: behind + (index === 1 ? 0 : 2),
    up: Math.round(low + (high - low) * share),
    length: Math.max(
      2,
      Math.round(STREAK_LENGTH * left * (index === 1 ? 1 : 0.6)),
    ),
  }));
}
