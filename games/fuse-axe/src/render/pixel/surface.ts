import type { Palette } from "./palette.js";
import {
  CLEAR,
  flashPalette,
  flipSprite,
  swapPalette,
  validateSprite,
  type Sprite,
} from "./sprite.js";

/** The part of a 2D context the baker paints with. A canvas's context is one, and so is a test's fake. */
export interface PixelPaint {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** Makes an offscreen surface: the image the renderer draws, and the paint that fills it. */
export type MakeSurface<Image> = (
  width: number,
  height: number,
) => { readonly image: Image; readonly paint: PixelPaint };

/** A sprite baked into an image; draw it with its anchor on the feet: `drawImage(image, x - ax, y - ay)`. */
export interface Baked<Image> {
  readonly image: Image;
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
}

export interface BakeOptions {
  /**
   * A palette override such as a duplicate hero's; its identity keys the cache, so pass a constant (a copy built per
   * draw is baked again each time) and do not change it afterwards.
   */
  readonly swap?: Palette;
  /** The damage flash. */
  readonly flash?: boolean;
  /** Face left. */
  readonly flip?: boolean;
}

export interface SpriteBaker<Image> {
  bake(sprite: Sprite, options?: BakeOptions): Baked<Image>;
}

/** Paints a sprite's pixels with its own palette, one rectangle per run of a colour along a row. */
export function paintSprite(paint: PixelPaint, sprite: Sprite): void {
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const key = row[x]!;
      let end = x + 1;
      while (row[end] === key) end++;
      if (key !== CLEAR) {
        paint.fillStyle = sprite.palette[key]!;
        paint.fillRect(x, y, end - x, 1);
      }
      x = end;
    }
  });
}

const NO_SWAP: Palette = {};

/**
 * Bakes each sprite variant once into a surface from `make` and returns the same one after: the cache is keyed by
 * the sprite, the swap, the flash and the flip, and drops a sprite's surfaces when the sprite is gone.
 */
export function createSpriteBaker<Image>(
  make: MakeSurface<Image>,
): SpriteBaker<Image> {
  const cache = new WeakMap<Sprite, WeakMap<Palette, Baked<Image>[]>>();
  return {
    bake(sprite, { swap = NO_SWAP, flash = false, flip = false } = {}) {
      const bySwap = cache.get(sprite) ?? new WeakMap();
      cache.set(sprite, bySwap);
      const variants = bySwap.get(swap) ?? [];
      bySwap.set(swap, variants);
      const slot = (flip ? 2 : 0) + (flash ? 1 : 0);
      const known = variants[slot];
      if (known) return known;
      // Validated with the swap applied, so a swap colour that is not `#rrggbb` fails here, not as a wrong pixel.
      let art = swapPalette(sprite, swap);
      validateSprite(art);
      if (flash) art = { ...art, palette: flashPalette(art.palette) };
      if (flip) art = flipSprite(art);
      const { image, paint } = make(art.w, art.h);
      paintSprite(paint, art);
      const { w, h, ax, ay } = art;
      return (variants[slot] = { image, w, h, ax, ay });
    },
  };
}
