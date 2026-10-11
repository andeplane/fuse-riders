import type { EnemyAnim, Tier } from "../../engine/view.js";
import { LANCER_STEPS } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import { RAVAGER_ANIMS, type RavagerFrame } from "./ravager.js";

/**
 * The lancer until it has art of its own: the ravager's figure in a palette of its own (a bronze helm and green
 * leathers over the tier's tunic), its spear drawn by the scene as a line along its facing while it thrusts.
 */
export type LancerAnim = Exclude<
  EnemyAnim,
  "attack" | "stumble" | "flee" | "slam" | "sweep" | "stagger" | "ride"
>;

const once = (frame: RavagerFrame, steps: number): AnimStrip<RavagerFrame> => ({
  frames: [[frame, steps]],
  loop: false,
});

/**
 * The lancer's anims in the ravager's frames, timed to the engine: the wind-up (an ash lancer's; quicker tiers hold it
 * shorter), the thrust and recovery, the leap rising then falling, and the plunge standing over its spear.
 */
export const LANCER_ANIMS: Readonly<
  Record<LancerAnim, AnimStrip<RavagerFrame>>
> = {
  idle: RAVAGER_ANIMS.idle,
  walk: RAVAGER_ANIMS.walk,
  enter: RAVAGER_ANIMS.enter,
  hurt: RAVAGER_ANIMS.hurt,
  knockdown: RAVAGER_ANIMS.knockdown,
  down: RAVAGER_ANIMS.down,
  getup: RAVAGER_ANIMS.getup,
  dead: RAVAGER_ANIMS.dead,
  held: RAVAGER_ANIMS.held,
  thrown: RAVAGER_ANIMS.thrown,
  windup: once("windup", LANCER_STEPS.windup[0]),
  thrust: once("attack", LANCER_STEPS.thrust),
  recover: once("recover", LANCER_STEPS.recover),
  leap: {
    frames: [
      ["walk2", LANCER_STEPS.leapApex + 1],
      ["windup", LANCER_STEPS.leap - LANCER_STEPS.leapApex - 1],
    ],
    loop: false,
  },
  plunge: once("attack", LANCER_STEPS.plunge),
};

const OWN: Palette = { ...rampSwap("Ii#", "Nn8"), ...rampSwap("Ll9", "Vv!") };
/** A palette per tier: its own over ash, and over the ravagers' rust and violet tunics. */
export const LANCER_TIERS: Readonly<Record<Tier, Palette>> = {
  0: OWN,
  1: { ...OWN, ...rampSwap("Aa$", "Tt%") },
  2: { ...OWN, ...rampSwap("Aa$", "Qq^") },
};
