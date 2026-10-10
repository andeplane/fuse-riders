import type { HeroKind } from "../../engine/view.js";
import type { Figure } from "../pixel/kit.js";
import type { Sprite } from "../pixel/sprite.js";
import type { HeroFrame } from "./animate.js";
import { BRAKKA, BRAKKA_PORTRAIT } from "./brakka.js";

/** Every figure the game draws, by name. The sprite sheet lab (`games/fuse-axe/lab/sprites.html`) shows them all. */
export const FIGURES: Readonly<Record<string, Figure>> = { brakka: BRAKKA };

/** A hero's figure, which paints every `HERO_FRAMES` frame, and its HUD portrait. */
export interface HeroArt {
  readonly figure: Figure<HeroFrame>;
  readonly portrait: Sprite;
}
/** The heroes' art by kind; Rhea and Gorm are still to come. */
export const HEROES: Readonly<Partial<Record<HeroKind, HeroArt>>> = {
  brakka: { figure: BRAKKA, portrait: BRAKKA_PORTRAIT },
};
