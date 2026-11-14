import type { BikeSprites } from "../render/bike.js";
import { slotHueShift } from "../render/palette.js";
import type { SceneArt } from "../render/scene.js";
import type { CanvasFactory } from "../render/terrain.js";
import { shiftHue } from "../render/tint.js";

/**
 * The generated art (`docs/design/elasto-fuse-art.md`), loaded in the background. The scene asks for it every frame
 * and draws its procedural fallback for anything not here yet, so a slow or failed download never holds a race up.
 * The bike and rider are painted with one cyan accent; each roster slot's copy is turned to its own hue the first
 * time that slot is drawn.
 */
export interface ImageLoader {
  /** Resolves with the decoded image, or undefined when it cannot be loaded. */
  load(url: string): Promise<CanvasImageSource | undefined>;
}
/** Turns an image's hue by `degrees` on a canvas of its own; undefined when the browser will not let it. */
export type Tinter = (
  image: CanvasImageSource,
  degrees: number,
) => CanvasImageSource | undefined;

/** The manifest: every file the scene can use, by the name it knows it under. */
export const ART_FILES = {
  ground: "ground.webp",
  sky: "sky.webp",
  apple: "apple.png",
  flower: "flower.png",
  killer: "killer.png",
  wheel: "wheel.png",
  frame: "frame.png",
  torso: "torso.png",
  head: "head.png",
  thigh: "thigh.png",
  shin: "shin.png",
  upperArm: "upper-arm.png",
  forearm: "forearm.png",
} as const;
export type ArtKey = keyof typeof ART_FILES;
/** The sprites that carry the rider's colour. */
export const BIKE_KEYS = [
  "wheel",
  "frame",
  "torso",
  "head",
  "thigh",
  "shin",
  "upperArm",
  "forearm",
] as const satisfies readonly ArtKey[];

export const artBase = (base: string): string =>
  `${base}games/elasto-fuse/art/v1/`;

export function loadArt(
  base: string,
  loader: ImageLoader,
  tint: Tinter,
): () => SceneArt {
  const root = artBase(base);
  const got: Partial<Record<ArtKey, CanvasImageSource>> = {};
  /** Each slot's tinted sprites, by the plain image they were made from. */
  const tinted = new Map<number, Map<CanvasImageSource, CanvasImageSource>>();
  const bikes = new Map<number, BikeSprites>();
  const bike = (slot: number): BikeSprites | undefined => {
    const known = bikes.get(slot);
    if (known) return known;
    const shift = slotHueShift(slot);
    let cache = tinted.get(slot);
    if (!cache) tinted.set(slot, (cache = new Map()));
    const sprites: BikeSprites = {};
    let any = false;
    for (const key of BIKE_KEYS) {
      const plain = got[key];
      if (!plain) continue;
      let image = cache.get(plain);
      if (!image) {
        // A browser that refuses the pixels keeps the cyan sprite: a wrong colour beats no rider.
        image = shift === 0 ? plain : (tint(plain, shift) ?? plain);
        cache.set(plain, image);
      }
      sprites[key] = image;
      any = true;
    }
    if (!any) return undefined;
    bikes.set(slot, sprites);
    return sprites;
  };
  let art: SceneArt = { bike };
  const update = () => {
    // A sprite arrived: every slot's set is put together again, reusing what was tinted.
    bikes.clear();
    art = {
      ...(got.ground ? { ground: got.ground } : {}),
      ...(got.sky ? { sky: got.sky } : {}),
      ...(got.apple ? { apple: got.apple } : {}),
      ...(got.flower ? { flower: got.flower } : {}),
      ...(got.killer ? { killer: got.killer } : {}),
      bike,
    };
  };
  for (const key of Object.keys(ART_FILES) as ArtKey[])
    void loader
      .load(root + ART_FILES[key])
      .then((image) => {
        if (!image) return;
        got[key] = image;
        update();
      })
      .catch(() => {
        /* the fallback stays */
      });
  return () => art;
}

/** The browser's loader: an `Image`, decoded before it is used so the first frame that draws it does not stall. */
export const browserImages: ImageLoader = {
  async load(url) {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
      return image;
    } catch {
      return undefined;
    }
  },
};

/** A canvas of the page's document, for the ground tile and the tinted sprites. */
export const browserCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** The browser's tinter: the image drawn on a canvas of its own size and its pixels turned in place. */
export const browserTint: Tinter = (image, degrees) => {
  const size = image as { naturalWidth?: number; naturalHeight?: number };
  const width = size.naturalWidth ?? 0,
    height = size.naturalHeight ?? 0;
  if (!width || !height) return undefined;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return undefined;
    g.drawImage(image, 0, 0);
    const pixels = g.getImageData(0, 0, width, height);
    shiftHue(pixels.data, degrees);
    g.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    return undefined;
  }
};
