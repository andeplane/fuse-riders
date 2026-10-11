import type { EnemyAnim } from "../../engine/view.js";
import type { AnimStrip } from "./animate.js";
import {
  LANCER_ANIMS,
  LANCER_POSES,
  buildLancer,
  lancerAt as F,
  paintLancer,
} from "./lancer.js";
import { figure } from "../pixel/kit.js";
import { rampSwap } from "../pixel/palette.js";

/**
 * The lancer captain, Wyrmbone Pass's boss, until he has a look of his own: a lancer in gold and dark steel
 * (`CAPTAIN_LOOK`, whatever his palette), who staggers as a lancer reels, and on his ember drake sits astride its
 * saddle as the ravager sits a clawbeak (his boot's sole on the saddle point, his hips on the seat, the far leg out of
 * sight), the spear couched and pointing ahead, the far hand on the reins.
 */
export const CAPTAIN_LOOK = {
  ...rampSwap("Cc0", "Nn8"),
  ...rampSwap("Mm7", "Ii#"),
};
const ride = {
  ...buildLancer({
    head: F(3, 36.5),
    chest: F(0.5, 27),
    waist: F(0, 21),
    shoulders: [F(-5, 30), F(6, 29.5)],
    hand: F(7.5, 23),
    spear: -14,
    free: F(10, 19.5),
    hips: [F(-2.5, 16.5), F(2, 16.5)],
    ankles: [F(-2, 2.5), F(3, 2.5)],
  }),
  astride: true,
};

export const CAPTAIN_POSES = { ...LANCER_POSES, ride };
export type CaptainFrame = keyof typeof CAPTAIN_POSES;
/** A lancer's anims, staggering as a lancer reels, and riding in his seated frame. */
export const CAPTAIN_ANIMS: Readonly<
  Partial<Record<EnemyAnim, AnimStrip<CaptainFrame>>>
> & { readonly idle: AnimStrip<CaptainFrame> } = {
  ...LANCER_ANIMS,
  stagger: LANCER_ANIMS.hurt,
  ride: { frames: [["ride", 32]], loop: false },
};
export const CAPTAIN = figure(CAPTAIN_POSES, paintLancer);
