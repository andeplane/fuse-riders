import type { HeroKind } from "../../engine/view.js";
import type { Figure, Pose } from "../pixel/kit.js";
import type { Sprite } from "../pixel/sprite.js";
import type { HeroFrame } from "./animate.js";
import { BRAKKA, BRAKKA_PORTRAIT, BRAKKA_POSES } from "./brakka.js";
import { RAVAGER } from "./ravager.js";
import { RHEA, RHEA_PORTRAIT, RHEA_POSES } from "./rhea.js";

/** Every figure the game draws, by name. The sprite sheet lab (`games/fuse-axe/lab/sprites.html`) shows them all. */
export const FIGURES: Readonly<Record<string, Figure>> = {
  brakka: BRAKKA,
  rhea: RHEA,
  ravager: RAVAGER,
};

/** A hero's figure, which paints every `HERO_FRAMES` frame, the poses it paints them from, and its HUD portrait. */
export interface HeroArt {
  readonly figure: Figure<HeroFrame>;
  readonly poses: Readonly<Record<HeroFrame, Pose>>;
  readonly portrait: Sprite;
}
/** The heroes' art by kind; Gorm is still to come. */
export const HEROES: Readonly<Partial<Record<HeroKind, HeroArt>>> = {
  brakka: { figure: BRAKKA, poses: BRAKKA_POSES, portrait: BRAKKA_PORTRAIT },
  rhea: { figure: RHEA, poses: RHEA_POSES, portrait: RHEA_PORTRAIT },
};
