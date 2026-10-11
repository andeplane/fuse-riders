import type {
  EnemyAnim,
  EnemyKind,
  HeroKind,
  MountAnim,
  MountKind,
} from "../../engine/view.js";
import {
  BACK_STEPS,
  CLAWBEAK_STEPS,
  DASH_STEPS,
  DRAKE_STEPS,
  HERO_STATES,
  JUMP_RISE_STEPS,
  STAB_STEPS,
  SWING_STEPS,
  THROW_STEPS,
  type DashSteps,
  type SwingSteps,
  type Swings,
} from "../../engine/view-kit.js";
import { CAPTAIN_ANIMS } from "./captain.js";
import { CLAWBEAK_ANIMS } from "./clawbeak.js";
import { DRAKE_ANIMS } from "./drake.js";
import { IMP_ANIMS } from "./imp.js";
import { LANCER_ANIMS } from "./lancer.js";
import { OGRE_ANIMS } from "./ogre.js";
import { RAVAGER_ANIMS } from "./ravager.js";

/**
 * Which sprite frame a hero shows: a pure function of its anim, the steps since the anim began and the engine's
 * timing, so every device draws the same frame for the same world. Every hero figure paints all of `HERO_FRAMES`.
 */
export const HERO_FRAMES = [
  ...["idle0", "idle1"],
  ...["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"],
  ...["rise", "fall", "land"],
  ...["windup1", "strike1", "follow1"],
  ...["windup2", "strike2", "follow2"],
  ...["windup3", "strike3", "follow3"],
  ...["hurt", "knockdown", "down", "getup"],
  ...["charge", "cast"],
  ...["run0", "run1", "run2", "run3", "run4", "run5"],
  ...["dash", "dashstop", "jumpwindup", "jumpstab"],
  ...["backwindup", "backstrike", "backfollow"],
  ...["grab", "heave", "toss"],
  ...["ride", "ridewindup", "rideattack", "ridehop"],
] as const;
export type HeroFrame = (typeof HERO_FRAMES)[number];
/** The frames a blow is out in: each swing's strike, the dash's lunge, the jump attack's stab and the back attack's. */
export const STRIKE_FRAMES: readonly HeroFrame[] = [
  "strike1",
  "strike2",
  "strike3",
  "dash",
  "jumpstab",
  "backstrike",
];

/**
 * Every anim a hero has: the walk, run, jump, swings and dash, the jump attack, back attack, grab and throw, and the
 * `hurt` to `dead` a ravager's mace brings; `respawn` drops back in with the fall frame, and one who is `out` lies as
 * `dead` does. Every move has frames of its own: the run a sprint, the dash a charge and its stop, the jump attack a
 * stab down, the back attack a blow behind (the figure is not turned: the engine keeps its facing, and the hero looks
 * over its shoulder), the grab its clutch and the throw a heave over the shoulder. Magic has two: charging braces with
 * the weapon raised before the face, and casting thrusts it skyward until the spell is gone. Riding a beast sits astride
 * its saddle, the far leg out of sight and the near boot in the stirrup, weapon held ready; what the rider does in the
 * saddle follows its beast's anim (`riderFrame`).
 */
export const HERO_ANIMS = [
  ...["idle", "walk", "run", "jump", "land"],
  ...["attack1", "attack2", "attack3", "dash"],
  ...["jumpattack", "backattack", "grab", "throw"],
  ...["hurt", "knockdown", "down", "getup", "dead", "respawn", "out"],
  ...["charge", "cast", "ride"],
] as const;
export type FigureAnim = (typeof HERO_ANIMS)[number];
// The engine's states must all have frames: a new one fails to compile here until it is mapped below.
HERO_STATES satisfies readonly FigureAnim[];

/**
 * A hero's engine timing: its three swings (`attack1`–`attack3`), the steps from take-off to a jump's apex, its back
 * attack, the steps its jump attack winds up and its dash.
 */
export interface HeroTiming {
  readonly swings: Swings;
  readonly rise: number;
  readonly back: SwingSteps;
  readonly stab: number;
  readonly dash: DashSteps;
}
const engineTiming = (kind: HeroKind): HeroTiming => ({
  swings: SWING_STEPS[kind],
  rise: JUMP_RISE_STEPS,
  back: BACK_STEPS[kind],
  stab: STAB_STEPS[kind],
  dash: DASH_STEPS[kind],
});
/** Each hero's timing as the engine has it, `heroFrame`'s default. */
export const HERO_TIMING: Readonly<Record<HeroKind, HeroTiming>> = {
  brakka: engineTiming("brakka"),
  rhea: engineTiming("rhea"),
  gorm: engineTiming("gorm"),
};

/** Steps each idle frame holds: a slow breath in and out. */
export const BREATH_STEPS = 40;
/**
 * Steps each walk frame holds: a hero's walking speed times this is the ground a planted foot must keep pace with
 * (1 px a step times 6 for Brakka, 1.25 px times 5 for Rhea and 0.8 px times 5 for Gorm's short quick steps, whose
 * strides are drawn for it). It holds on a straight walk along the road; walking in depth is slower and the foot
 * slides a little.
 */
export const WALK_STEPS: Readonly<Record<HeroKind, number>> = {
  brakka: 6,
  rhea: 5,
  gorm: 5,
};
/**
 * Steps each run frame holds: a hero's running speed times this is the ground a planted foot keeps pace with (1.875 px
 * a step times 4 for Brakka, 2.25 px times 4 for Rhea and 1.5 px times 3 for Gorm's short legs).
 */
export const RUN_STEPS: Readonly<Record<HeroKind, number>> = {
  brakka: 4,
  rhea: 4,
  gorm: 3,
};
/**
 * Steps the throw shows its heave, the body over the hero's head, from the step it leaves the hands; the toss
 * follows through to the throw's end. A quarter of the throw, rounded up so that it counts whole steps whatever the
 * engine tunes the throw to.
 */
export const HEAVE_STEPS = Math.ceil(THROW_STEPS / 4);
const WALK = ["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"] as const;
const RUN = ["run0", "run1", "run2", "run3", "run4", "run5"] as const;
const SWING = [
  ["windup1", "strike1", "follow1"],
  ["windup2", "strike2", "follow2"],
  ["windup3", "strike3", "follow3"],
] as const;
const BACK = ["backwindup", "backstrike", "backfollow"] as const;

/** A swing's frame `step` steps in: the wind-up, the strike for the steps the blade is out, then the follow-through. */
function swingFrame(
  { startup, active }: SwingSteps,
  [windup, strike, follow]: readonly [HeroFrame, HeroFrame, HeroFrame],
  step: number,
): HeroFrame {
  if (step < startup) return windup;
  return step < startup + active ? strike : follow;
}

/**
 * The frame for a hero `animStep` steps into `anim`: the strike exactly while the blade is out (a swing's or the back
 * attack's active steps, the jump attack's from its wind-up on, the dash's lunge while it slides), the wind-up before
 * and the follow-through after; the walk, the run and the breath cycle; a jump rises, then falls; the grab clutches and
 * the throw heaves, then tosses.
 * The engine counts `animStep` only in the steps it runs, so a hit's freeze holds the strike frame. It never throws,
 * as the renderer calls it every frame: a step that is not a whole number from 0 is rounded down to one, and an anim
 * that has no case (one added to `FigureAnim` without a frame fails to compile) stands idle.
 */
export function heroFrame(
  kind: HeroKind,
  anim: FigureAnim,
  animStep: number,
  timing: Readonly<Record<HeroKind, HeroTiming>> = HERO_TIMING,
): HeroFrame {
  const step = Number.isFinite(animStep)
    ? Math.max(0, Math.floor(animStep))
    : 0;
  switch (anim) {
    case "idle":
      return Math.floor(step / BREATH_STEPS) % 2 ? "idle1" : "idle0";
    case "walk":
      return WALK[Math.floor(step / WALK_STEPS[kind]) % WALK.length]!;
    case "run":
      return RUN[Math.floor(step / RUN_STEPS[kind]) % RUN.length]!;
    case "jump":
      return step < timing[kind].rise ? "rise" : "fall";
    case "land":
      return "land";
    case "ride":
      return "ride";
    case "attack1":
      return swingFrame(timing[kind].swings[0], SWING[0], step);
    case "attack2":
      return swingFrame(timing[kind].swings[1], SWING[1], step);
    case "attack3":
      return swingFrame(timing[kind].swings[2], SWING[2], step);
    case "dash":
      return step < timing[kind].dash.active ? "dash" : "dashstop";
    case "jumpattack":
      return step < timing[kind].stab ? "jumpwindup" : "jumpstab";
    case "backattack":
      return swingFrame(timing[kind].back, BACK, step);
    case "grab":
      return "grab";
    case "throw":
      return step < HEAVE_STEPS ? "heave" : "toss";
    case "charge":
      return "charge";
    case "cast":
      return "cast";
    case "hurt":
      return "hurt";
    case "knockdown":
      return "knockdown";
    case "respawn":
      return "fall";
    case "down":
    case "dead":
    case "out":
      return "down";
    case "getup":
      return "getup";
    default:
      anim satisfies never;
      return "idle0";
  }
}

/**
 * The frame a hero riding a beast shows, `animStep` steps into the beast's `anim` (the hero's own anim is `ride`
 * throughout: the beast's says what the pair does). Through a tail sweep's wind-up it braces, weapon cocked, and from
 * the step the tail lands it leans into the blow, weapon pointed at the foe, to the sweep's end; a drake's breath is the
 * same, bracing through the inhale and pointing from the step the flame is out to the breath's end; through a hop it
 * crouches forward over the neck; otherwise it sits, weapon ready. The captain's saddle thrust (`lance`) is no hero's,
 * and a riderless beast's anims have no rider: they sit. Like `heroFrame` it never throws: an odd step is rounded down
 * to a whole one from 0, and an anim with no case (or one from a build with more of them) sits.
 */
export function riderFrame(anim: MountAnim, animStep: number): HeroFrame {
  const step = Number.isFinite(animStep)
    ? Math.max(0, Math.floor(animStep))
    : 0;
  switch (anim) {
    case "sweep":
      return step < CLAWBEAK_STEPS.windup ? "ridewindup" : "rideattack";
    case "breathe":
      return step < DRAKE_STEPS.inhale ? "ridewindup" : "rideattack";
    case "hop":
      return "ridehop";
    default:
      return "ride";
  }
}

/** An anim's frames in order, each with the simulation steps (60 a second) it shows. */
export interface AnimStrip<F extends string> {
  readonly frames: readonly (readonly [frame: F, steps: number])[];
  /** Starts over after the last frame; an anim that does not loop holds its last frame for as long as it lasts. */
  readonly loop: boolean;
}

/** An enemy kind's strip per anim: an anim it lacks stands idle. */
export type EnemyAnims = Readonly<
  Partial<Record<EnemyAnim, AnimStrip<string>>>
> & { readonly idle: AnimStrip<string> };
/** Every enemy kind's anims, which `enemyFrame` plays. */
export const ENEMY_ANIMS: Readonly<Record<EnemyKind, EnemyAnims>> = {
  ravager: RAVAGER_ANIMS,
  imp: IMP_ANIMS,
  ogre: OGRE_ANIMS,
  lancer: LANCER_ANIMS,
  captain: CAPTAIN_ANIMS,
};

/**
 * The frame of its kind's figure an enemy shows `animStep` steps into `anim`, played from `ENEMY_ANIMS`. Like
 * `heroFrame` it never throws, as the renderer calls it every frame: an anim the kind has no strip for (a ravager's
 * `flee`, or one from a build with more of them) stands idle, a kind from such a build plays as a ravager (the
 * scene's fallback figure), and an odd step is rounded down to a whole one from 0.
 */
export function enemyFrame(
  kind: EnemyKind,
  anim: EnemyAnim,
  animStep: number,
): string {
  const anims = Object.hasOwn(ENEMY_ANIMS, kind)
    ? ENEMY_ANIMS[kind]
    : ENEMY_ANIMS.ravager;
  const strip = Object.hasOwn(anims, anim) ? anims[anim] : undefined;
  return stripFrame(strip ?? anims.idle, animStep);
}

/** A beast kind's strip per anim: an anim it lacks (a clawbeak's breath) stands idle. */
export type MountAnims = Readonly<
  Partial<Record<MountAnim, AnimStrip<string>>>
> & { readonly idle: AnimStrip<string> };
/** Every beast kind's anims, which `mountFrame` plays: a clawbeak's sweeps its tail, an ember drake's breathes fire. */
export const MOUNT_ANIMS: Readonly<Record<MountKind, MountAnims>> = {
  clawbeak: CLAWBEAK_ANIMS,
  drake: DRAKE_ANIMS,
};

/**
 * The frame of its kind's figure a beast shows `animStep` steps into `anim`, played from `MOUNT_ANIMS`. Like
 * `enemyFrame` it never throws: a kind from a build with more of them plays as a clawbeak (the scene's fallback
 * figure), an anim from such a build stands idle, and an odd step is rounded down to a whole one from 0.
 */
export function mountFrame(
  kind: MountKind,
  anim: MountAnim,
  animStep: number,
): string {
  const anims = Object.hasOwn(MOUNT_ANIMS, kind)
    ? MOUNT_ANIMS[kind]
    : MOUNT_ANIMS.clawbeak;
  const strip = Object.hasOwn(anims, anim) ? anims[anim] : undefined;
  return stripFrame(strip ?? anims.idle, animStep);
}

/**
 * The frame an anim strip shows `animStep` steps in: a looping strip wraps, a one-shot holds its last frame for as long
 * as the anim lasts. Like `heroFrame` it never throws: an odd step is rounded down to a whole one from 0.
 */
export function stripFrame<F extends string>(
  { frames, loop }: AnimStrip<F>,
  animStep: number,
): F {
  const total = frames.reduce((sum, [, steps]) => sum + steps, 0);
  let step = Number.isFinite(animStep) ? Math.max(0, Math.floor(animStep)) : 0;
  if (loop && total > 0) step %= total;
  for (const [frame, steps] of frames) {
    if (step < steps) return frame;
    step -= steps;
  }
  return frames.at(-1)![0];
}
