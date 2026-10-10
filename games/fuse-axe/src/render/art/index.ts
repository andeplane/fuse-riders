import type { Figure } from "../pixel/kit.js";
import { BRAKKA } from "./brakka.js";
import { RAVAGER } from "./ravager.js";

/** Every figure the game draws, by name. The sprite sheet lab (`games/fuse-axe/lab/sprites.html`) shows them all. */
export const FIGURES: Readonly<Record<string, Figure>> = {
  brakka: BRAKKA,
  ravager: RAVAGER,
};
