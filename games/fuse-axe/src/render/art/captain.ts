import type { EnemyAnim, MountAnim } from "../../engine/view.js";
import { DRAKE_STEPS, OGRE_STEPS, SPEAR } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import {
  LANCER_ANIMS,
  LANCER_POSES,
  THRUST_HOLD,
  buildLancer as build,
  lancerAt as F,
  paintLancer,
  type LancerGear,
  type LancerPose,
} from "./lancer.js";
import { figure } from "../pixel/kit.js";

/**
 * The lancer captain, Wyrmbone Pass's boss: a lancer's build in black steel edged in gold, a gold pauldron, a black
 * helm under a tall red crest, a red cape down his back and a heavier spear with a broad head. He fights on foot in
 * the lancer's poses, staggers in his armour where a lancer reels, and on his ember drake sits astride its saddle (the
 * clawbeak's convention: his boot's sole on the saddle point, his hips on the seat) with his spear couched, drawing it
 * back for his saddle thrust and driving it out to `SPEAR.reach` from the step it lands.
 */
export const CAPTAIN_GEAR: LancerGear = {
  armour: "i",
  helm: "i",
  pad: "n",
  plume: [
    [1, -5.5, 1.4],
    [0, -11.5, 2.3],
    [-5, -14, 2.3],
    [-10.5, -10, 1.6],
    [-12.5, -3.5, 0.6],
  ],
  haft: 1,
  blade: 4.6,
  cape: "c",
  trim: "n",
};

/** Seated astride, as the ravager sits: hips 16.5 px over the boot's sole, the near leg down the flank to the stirrup. */
const SEAT = { hips: [F(-2.5, 16.5), F(2, 16.5)], ankles: [F(-2, 2.5), F(3, 2.5)] } as const; // prettier-ignore
const astride = (pose: LancerPose): LancerPose => ({ ...pose, astride: true });

/** On his drake: upright in the saddle, the spear couched under his arm and pointing ahead, the far hand on the reins. */
const ride = astride(
  build({
    head: F(3, 36.5),
    chest: F(0.5, 27),
    waist: F(0, 21),
    shoulders: [F(-5, 30), F(6, 29.5)],
    hand: F(7.5, 23),
    spear: -14,
    free: F(10, 19.5),
    ...SEAT,
  }),
);
/** The saddle thrust's wind-up: leaning back, the spear drawn back level in both hands, its point glinting. */
const ridewindup = astride(
  build(
    {
      head: F(0, 36),
      tilt: -8,
      chest: F(-1.5, 26.5),
      waist: F(-0.5, 21),
      shoulders: [F(-7, 29.5), F(4, 29)],
      hand: F(1.5, 25.5),
      spear: -4,
      grip: 10,
      ...SEAT,
    },
    { glint: true },
  ),
);
/** The thrust: lunging forward in the saddle, both arms driving the spear out level, its point at `SPEAR.reach`. */
const ridethrust = astride(
  build(
    {
      head: F(6.5, 35),
      tilt: 12,
      chest: F(3.5, 26),
      waist: F(1, 21),
      shoulders: [F(-1.5, 29), F(8.5, 28.5)],
      // Mid-pixel, as a lancer's thrust: the point's pixel is the one at `SPEAR.reach`.
      hand: F(SPEAR.reach - THRUST_HOLD, 26.5),
      hold: THRUST_HOLD,
      spear: 0,
      grip: 10,
      ...SEAT,
    },
    { lunge: true },
  ),
);
/** Staggered: rocked back on his heels by a blow his armour takes, the spear brought across him in both hands. */
const stagger = build({
  head: F(-2, 37.5),
  tilt: -14,
  chest: F(-2, 28.5),
  waist: F(-0.5, 22.5),
  shoulders: [F(-7.5, 31.5), F(3.5, 31)],
  hand: F(8, 25),
  spear: -58,
  grip: 9,
  hips: [F(-3, 18.5), F(2, 18.5)],
  ankles: [F(-10, 2.5), F(6, 2.5)],
});

export const CAPTAIN_POSES = {
  ...LANCER_POSES,
  stagger,
  ride,
  ridewindup,
  ridethrust,
};
export type CaptainFrame = keyof typeof CAPTAIN_POSES;
const once = (frame: CaptainFrame, steps: number): AnimStrip<CaptainFrame> => ({
  frames: [[frame, steps]],
  loop: false,
});

/**
 * The captain's anims: a lancer's on foot, the stagger his own (as long as the engine holds it, an ogre's), and riding
 * his own seated frame; what he does in the saddle follows his beast's anim (`CAPTAIN_SADDLE`).
 */
export const CAPTAIN_ANIMS: Readonly<
  Partial<Record<EnemyAnim, AnimStrip<CaptainFrame>>>
> & { readonly idle: AnimStrip<CaptainFrame> } = {
  ...LANCER_ANIMS,
  stagger: once("stagger", OGRE_STEPS.stagger),
  ride: once("ride", 32),
};
/**
 * What the captain does in the saddle, by his drake's anim: through the saddle thrust's wind-up he draws the spear back,
 * and from the step it lands (`DRAKE_STEPS.lanceWindup`) to its end it is out at full reach. Otherwise he sits.
 */
export const CAPTAIN_SADDLE: Readonly<
  Partial<Record<MountAnim, AnimStrip<CaptainFrame>>>
> = {
  lance: {
    frames: [
      ["ridewindup", DRAKE_STEPS.lanceWindup],
      ["ridethrust", DRAKE_STEPS.lance - DRAKE_STEPS.lanceWindup],
    ],
    loop: false,
  },
};

export const CAPTAIN = figure(CAPTAIN_POSES, (pose: LancerPose) =>
  paintLancer(pose, CAPTAIN_GEAR),
);
