import type { HeroKind } from "../../engine/view.js";
import {
  HERO_STATES,
  JUMP_RISE_STEPS,
  SWING_STEPS,
  type SwingSteps,
  type Swings,
} from "../../engine/view-kit.js";
import type { AnimStrip } from "./ravager.js";

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
] as const;
export type HeroFrame = (typeof HERO_FRAMES)[number];

/**
 * Every anim a hero has: the walk, run, jump, swings and dash, and the `hurt` to `dead` a ravager's mace brings;
 * `respawn` drops back in with the fall frame, and one who is `out` lies as `dead` does. Until the run and the dash
 * have frames of their own, the run strides through the walk's faster and the dash holds the first strike.
 */
export const HERO_ANIMS = [
  ...["idle", "walk", "run", "jump", "land"],
  ...["attack1", "attack2", "attack3", "dash"],
  ...["hurt", "knockdown", "down", "getup", "dead", "respawn", "out"],
] as const;
export type FigureAnim = (typeof HERO_ANIMS)[number];
// The engine's states must all have frames: a new one fails to compile here until it is mapped below.
HERO_STATES satisfies readonly FigureAnim[];

/** A hero's engine timing: its three swings (`attack1`–`attack3`) and the steps from take-off to a jump's apex. */
export interface HeroTiming {
  readonly swings: Swings;
  readonly rise: number;
}
/** Each hero's timing as the engine has it, `heroFrame`'s default. */
export const HERO_TIMING: Readonly<Record<HeroKind, HeroTiming>> = {
  brakka: { swings: SWING_STEPS.brakka, rise: JUMP_RISE_STEPS },
  rhea: { swings: SWING_STEPS.rhea, rise: JUMP_RISE_STEPS },
  gorm: { swings: SWING_STEPS.gorm, rise: JUMP_RISE_STEPS },
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
/** Steps each walk frame holds in a run: about twice the walk's speed, so about half its cadence. */
export const RUN_STEPS: Readonly<Record<HeroKind, number>> = {
  brakka: 3,
  rhea: 3,
  gorm: 3,
};
const WALK = ["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"] as const;
const SWING = [
  ["windup1", "strike1", "follow1"],
  ["windup2", "strike2", "follow2"],
  ["windup3", "strike3", "follow3"],
] as const;

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
 * The frame for a hero `animStep` steps into `anim`: the strike exactly while the blade is out (the swing's active
 * steps), the wind-up before and the follow-through after; the walk and the breath cycle; a jump rises, then falls.
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
      return WALK[Math.floor(step / RUN_STEPS[kind]) % WALK.length]!;
    case "jump":
      return step < timing[kind].rise ? "rise" : "fall";
    case "land":
      return "land";
    case "attack1":
      return swingFrame(timing[kind].swings[0], SWING[0], step);
    case "attack2":
      return swingFrame(timing[kind].swings[1], SWING[1], step);
    case "attack3":
      return swingFrame(timing[kind].swings[2], SWING[2], step);
    case "dash":
      return "strike1";
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
