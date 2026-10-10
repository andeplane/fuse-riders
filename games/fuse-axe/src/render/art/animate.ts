import type { HeroKind } from "../../engine/view.js";
import { HERO_STATES } from "../../engine/view-kit.js";

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

/** One swing's steps of wind-up, blade out and recovery, as view-kit's `SWING_STEPS` gives them. */
export interface SwingTiming {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
}

/** A hero's engine timing: its three swings (`attack1`–`attack3`) and the steps from take-off to a jump's apex. */
export interface HeroTiming {
  readonly swings: readonly SwingTiming[];
  readonly rise: number;
}

/** Steps each idle frame holds: a slow breath in and out. */
export const BREATH_STEPS = 40;
/** Steps each walk frame holds, so a planted foot keeps pace with the ground at the hero's walking speed. */
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

/**
 * The frame for a hero `animStep` steps into `anim`: the strike exactly while the blade is out (the swing's active
 * steps), the wind-up before and the follow-through after; the walk and the breath cycle; a jump rises, then falls.
 * Throws on an anim it has no frames for, or a step that is not a whole number from 0.
 */
export function heroFrame(
  kind: HeroKind,
  anim: string,
  animStep: number,
  timing: Readonly<Record<HeroKind, HeroTiming>>,
): HeroFrame {
  if (!Number.isInteger(animStep) || animStep < 0)
    throw new RangeError(
      `An anim step is a whole number from 0, not ${animStep}`,
    );
  switch (anim) {
    case "idle":
      return Math.floor(animStep / BREATH_STEPS) % 2 ? "idle1" : "idle0";
    case "walk":
      return WALK[Math.floor(animStep / WALK_STEPS[kind]) % WALK.length]!;
    case "jump":
      return animStep < timing[kind].rise ? "rise" : "fall";
    case "land":
      return "land";
    case "attack1":
    case "attack2":
    case "attack3": {
      const index = Number(anim.slice(-1)) - 1;
      const swing = timing[kind].swings[index];
      if (!swing) throw new Error(`No timing for ${kind}'s ${anim}`);
      const [windup, strike, follow] = SWING[index]!;
      if (animStep < swing.startup) return windup;
      return animStep < swing.startup + swing.active ? strike : follow;
    }
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
      throw new Error(`No frames for the anim "${anim}"`);
  }
}
