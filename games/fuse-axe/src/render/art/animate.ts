import type { HeroKind } from "../../engine/view.js";
import {
  HERO_STATES,
  JUMP_RISE_STEPS,
  SWING_STEPS,
  type SwingSteps,
  type Swings,
} from "../../engine/view-kit.js";

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

/** Every anim a hero has or will have; the heroes' `hurt` to `dead` arrive with the enemies' attacks. */
export const HERO_ANIMS = [
  ...["idle", "walk", "jump", "land"],
  ...["attack1", "attack2", "attack3"],
  ...["hurt", "knockdown", "down", "getup", "dead"],
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
 * (1 px a step times 6 for Brakka, whose stride is drawn for it; Rhea's and Gorm's art will draw theirs to match).
 * It holds on a straight walk along the road; walking in depth is slower and the foot slides a little.
 */
export const WALK_STEPS: Readonly<Record<HeroKind, number>> = {
  brakka: 6,
  rhea: 4,
  gorm: 6,
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
    case "hurt":
      return "hurt";
    case "knockdown":
      return "knockdown";
    case "down":
    case "dead":
      return "down";
    case "getup":
      return "getup";
    default:
      anim satisfies never;
      return "idle0";
  }
}
