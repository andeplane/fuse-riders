import type { HeroKind } from "../../engine/view.js";
import type { Figure, Pose } from "../pixel/kit.js";
import type { Sprite } from "../pixel/sprite.js";
import type { HeroFrame } from "./animate.js";
import { BONE_KNIGHT, BONEWALKER } from "./bonewalker.js";
import { BRAKKA, BRAKKA_PORTRAIT, BRAKKA_POSES } from "./brakka.js";
import { CAPTAIN } from "./captain.js";
import { CLAWBEAK_FIGURE } from "./clawbeak.js";
import { DRAKE_FIGURE } from "./drake.js";
import { GORM, GORM_PORTRAIT, GORM_POSES } from "./gorm.js";
import { IMP } from "./imp.js";
import { LANCER } from "./lancer.js";
import { OGRE } from "./ogre.js";
import { RAVAGER } from "./ravager.js";
import { RHEA, RHEA_PORTRAIT, RHEA_POSES } from "./rhea.js";
import { VORHAL } from "./vorhal.js";

/** Every figure the game draws, by name. The sprite sheet lab (`games/fuse-axe/lab/sprites.html`) shows them all. */
export const FIGURES: Readonly<Record<string, Figure>> = {
  brakka: BRAKKA,
  rhea: RHEA,
  gorm: GORM,
  ravager: RAVAGER,
  imp: IMP,
  ogre: OGRE,
  lancer: LANCER,
  captain: CAPTAIN,
  bonewalker: BONEWALKER,
  boneknight: BONE_KNIGHT,
  clawbeak: CLAWBEAK_FIGURE,
  drake: DRAKE_FIGURE,
  vorhal: VORHAL,
};

/** A hero's figure, which paints every `HERO_FRAMES` frame, the poses it paints them from, and its HUD portrait. */
export interface HeroArt {
  readonly figure: Figure<HeroFrame>;
  readonly poses: Readonly<Record<HeroFrame, Pose>>;
  readonly portrait: Sprite;
}
/** Every hero's art by kind. */
export const HEROES: Readonly<Record<HeroKind, HeroArt>> = {
  brakka: { figure: BRAKKA, poses: BRAKKA_POSES, portrait: BRAKKA_PORTRAIT },
  rhea: { figure: RHEA, poses: RHEA_POSES, portrait: RHEA_PORTRAIT },
  gorm: { figure: GORM, poses: GORM_POSES, portrait: GORM_PORTRAIT },
};
