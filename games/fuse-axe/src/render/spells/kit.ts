import * as K from "../../engine/view-kit.js";
import type { EnemyView, SpellView, WorldView } from "../../engine/view.js";
import { bayer, hash } from "../backdrop/kit.js";
import { blit, fill, type Pen } from "../pen.js";
import { pixelSurface, type MakeSurface } from "../surface.js";

/**
 * What the spells share: pictures painted once into surfaces from the renderer's one factory, a spell's timing from
 * `SPELL_STEPS`, and screen-wide veils. All of it is a pure function of the view and the 60 Hz frame, its only chance
 * the cosmetic `hash`, so a rollback or a blended frame draws the same pixels again.
 */
export { hash, type MakeSurface, type Pen };
const { VIEW_W: W, VIEW_H: H } = K;

/** A picture painted once, and a pixel setter: `0xrrggbb` at `alpha` (opaque by default), off the picture ignored. */
export interface Art<I> {
  readonly image: I;
  readonly w: number;
  readonly h: number;
}
export type Dot = (x: number, y: number, rgb: number, alpha?: number) => void;

export function bakeArt<I>(
  make: MakeSurface<I>,
  w: number,
  h: number,
  paint: (dot: Dot) => void,
): Art<I> {
  const rgba = new Uint8ClampedArray(w * h * 4);
  paint((x, y, rgb, alpha = 1) => {
    const [i, j] = [Math.floor(x), Math.floor(y)];
    if (i >= 0 && i < w && j >= 0 && j < h)
      rgba.set(
        [rgb >> 16, (rgb >> 8) & 255, rgb & 255, alpha * 255],
        (j * w + i) * 4,
      );
  });
  return { image: pixelSurface(make, w, h, rgba), w, h };
}

/** `art` with its top-left at the whole pixel at or before (`x`, `y`), clipped to the screen. */
export const put = <I>(pen: Pen<I>, art: Art<I>, x: number, y: number) =>
  blit(pen, art.image, art.w, art.h, Math.floor(x), Math.floor(y));

/** The part `[sx, sy, sw, sh]` of an image drawn unscaled at (`dx`, `dy`), clipped to the screen. */
export function blitPart<I>(
  pen: Pen<I>,
  image: I,
  [sx, sy, sw, sh]: readonly number[],
  dx: number,
  dy: number,
): void {
  const [x0, y0] = [Math.max(0, dx), Math.max(0, dy)];
  const [w, h] = [Math.min(W, dx + sw!) - x0, Math.min(H, dy + sh!) - y0];
  if (w > 0 && h > 0)
    pen.drawImage(image, sx! + x0 - dx, sy! + y0 - dy, w, h, x0, y0, w, h);
}

/** The pen moved `dx`, `dy` whole pixels and still clipped to the screen: the field drawn through it shakes. */
export const shifted = <I>(pen: Pen<I>, dx: number, dy: number): Pen<I> => ({
  get fillStyle() {
    return pen.fillStyle;
  },
  set fillStyle(style) {
    pen.fillStyle = style;
  },
  fillRect: (x, y, w, h) => fill(pen, x + dx, y + dy, w, h),
  drawImage: (image, sx, sy, sw, sh, x, y) =>
    blitPart(pen, image, [sx, sy, sw, sh], x + dx, y + dy),
});

/** A screen-sized veil of `rgb` at `alpha`, a pixel on where its dither threshold is under `density` at its row. */
export const veil = <I>(
  make: MakeSurface<I>,
  rgb: number,
  alpha: number,
  density: (y: number) => number,
) =>
  bakeArt(make, W, H, (dot) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (bayer(x, y) < density(y)) dot(x, y, rgb, alpha);
  });

/** The palette's fire ramp, light to dark, the platform's neon, and a colour as CSS. */
export const FLAME = [0xfff6b8, 0xffc22e, 0xf86420, 0xa82434] as const;
export const [WHITE, CYAN, VIOLET, LIME, INK] = [
  0xffffff, 0x16e7ff, 0x6544c2, 0xb6ff4d, 0x150c1f,
] as const;
export const css = (rgb: number) => `#${rgb.toString(16).padStart(6, "0")}`;
/** The floor's middle row, and the first row under the HUD's strip. */
export const FLOOR_MID = (K.FLOOR_TOP_PX + K.FLOOR_BOTTOM_PX) >> 1;
export const SKY = 22;

/** A spell's timing at its level (an odd level held to the ones its kind has), and how many it has. */
export interface Timing extends K.SpellSteps {
  readonly level: number;
  readonly max: number;
}
/** One pass of a kind's drawing, at its timing and whole-step age (0 to `steps − 1`) and a whole frame from 0. */
export type Play<I> = (
  pen: Pen<I>,
  spell: SpellView,
  t: Timing,
  age: number,
  view: WorldView,
  frame: number,
) => void;
/** A kind: what it lays on the ground under the figures, if anything, and what it draws over them. */
export interface KindArt<I> {
  readonly ground?: Play<I>;
  readonly over: Play<I>;
}

/** The spell's timing and whole-step age while it plays; undefined for a kind this build lacks or an odd age. */
export function playing(spell: SpellView) {
  if (!Object.hasOwn(K.SPELL_STEPS, spell.kind)) return undefined;
  const levels = K.SPELL_STEPS[spell.kind];
  const [max, age] = [levels.length, Math.floor(spell.age)];
  const level = Math.min(max, Math.max(1, Math.floor(spell.level) || 1));
  const t: Timing = { ...levels[level - 1]!, level, max };
  return age >= 0 && age < t.steps ? { t, age } : undefined;
}
/** 0 to 1 over a spell's first `rise` steps, 1 while it plays, back to 0 over its last `fall`. */
export const envelope = (age: number, steps: number, rise = 12, fall = 18) =>
  Math.max(0, Math.min(1, (age + 1) / rise, (steps - age) / fall));

/** Steps the blow's flash lasts from its `hit` step, and its shake. */
export const FLASH_STEPS = 6;
export const SHAKE_STEPS = 14;

/** The enemies a blow is drawn landing on: every one on screen but the sack imps, which it never strikes. */
export const targets = ({ enemies, camX }: WorldView): EnemyView[] =>
  enemies.filter((e) => e.kind !== "imp" && e.x >= camX && e.x < camX + W);
/** The caster's screen column, or the middle for a spell that outlived it. */
export const casterX = ({ heroes, camX }: WorldView, spell: SpellView) =>
  Math.floor(
    (heroes.find((h) => h.id === spell.hero)?.x ?? camX + W / 2) - camX,
  );
/** A floor spot for the `i`th extra strike of a spell `seed`, spread across the screen. */
export const spot = (i: number, seed: number): readonly [number, number] => [
  16 + Math.floor(((i * 0.618 + hash(i, seed) * 0.3) % 1) * (W - 32)),
  K.FLOOR_TOP_PX + 6 + Math.floor(hash(seed, i) * 58),
];
