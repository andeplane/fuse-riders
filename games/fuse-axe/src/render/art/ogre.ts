import type { EnemyAnim } from "../../engine/view.js";
import { OGRE_STEPS } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import { RAVAGER_ANIMS, type RavagerFrame } from "./ravager.js";

/**
 * The Ogre twins until they have art of their own: the ravager's figure drawn `OGRE_SCALE` times as big in a beast's
 * colours, one twin green and the other red (by tier, which is only an ogre's palette), playing the ravager's frames.
 */
export const OGRE_SCALE = 1.5;
export const OGRE_TIERS: Readonly<Record<0 | 1 | 2, Palette>> = {
  0: rampSwap("Aa$", "Yy&"),
  1: rampSwap("Aa$", "Xx*"),
  2: rampSwap("Aa$", "Ee4"),
};

/** The anims an ogre is shown in: never reeling, held or thrown, nor in a sack imp's. */
export type OgreAnim = Exclude<
  EnemyAnim,
  "hurt" | "attack" | "held" | "thrown" | "stumble" | "flee"
>;

/**
 * The ogre's anims from the ravager's frames: the slam's wind-up holds the wind-up for the calm wind-up's steps and
 * the slam the attack; the sweep winds up and swings; a stagger reels.
 */
export const OGRE_ANIMS: Readonly<Record<OgreAnim, AnimStrip<RavagerFrame>>> = {
  idle: RAVAGER_ANIMS.idle,
  walk: RAVAGER_ANIMS.walk,
  enter: RAVAGER_ANIMS.enter,
  windup: { frames: [["windup", OGRE_STEPS.windup]], loop: false },
  slam: { frames: [["attack", OGRE_STEPS.slam]], loop: false },
  sweep: {
    frames: [
      ["windup", OGRE_STEPS.sweepWindup],
      ["attack", OGRE_STEPS.sweep - OGRE_STEPS.sweepWindup],
    ],
    loop: false,
  },
  recover: { frames: [["recover", OGRE_STEPS.recover]], loop: false },
  stagger: { frames: [["hurt", OGRE_STEPS.stagger]], loop: false },
  knockdown: RAVAGER_ANIMS.knockdown,
  down: RAVAGER_ANIMS.down,
  getup: RAVAGER_ANIMS.getup,
  dead: RAVAGER_ANIMS.dead,
};
