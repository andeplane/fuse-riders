import { LIME_HUE_TURN } from "../render/palette.js";
import type { SceneArt } from "../render/scene.js";

/**
 * The generated art (`docs/design/fuse-volley-art.md`), loaded in the background. The scene asks for it every frame
 * and draws its procedural fallback for anything not here yet, so a slow or failed download never holds a match up.
 */
export interface ImageLoader {
  /** Resolves with the decoded image, or undefined when it cannot be loaded. */
  load(url: string): Promise<CanvasImageSource | undefined>;
  /** A copy of `image` with its colours turned `degrees` round the colour wheel, or undefined when it cannot. */
  recolour(
    image: CanvasImageSource,
    degrees: number,
  ): CanvasImageSource | undefined;
}

export const ART_FILES = {
  court: "court.webp",
  cyan: "blob-cyan.png",
  pink: "blob-pink.png",
  ball: "ball.png",
} as const;

export const artBase = (base: string): string =>
  `${base}games/fuse-volley/art/v1/`;

export function loadArt(base: string, loader: ImageLoader): () => SceneArt {
  let art: SceneArt = {};
  const root = artBase(base);
  const got: Partial<
    Record<keyof typeof ART_FILES | "lime", CanvasImageSource>
  > = {};
  const update = () => {
    art = {
      ...(got.court ? { court: got.court } : {}),
      ...(got.ball ? { ball: got.ball } : {}),
      ...(got.cyan || got.pink
        ? { blobs: [got.cyan, got.pink, got.lime] as const }
        : {}),
    };
  };
  for (const key of Object.keys(ART_FILES) as (keyof typeof ART_FILES)[])
    void loader
      .load(root + ART_FILES[key])
      .then((image) => {
        if (!image) return;
        got[key] = image;
        // The third team's blob (three teams of two) is the cyan one turned lime.
        if (key === "cyan") {
          const lime = loader.recolour(image, LIME_HUE_TURN);
          if (lime) got.lime = lime;
        }
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
  recolour(image, degrees) {
    const width = artWidth(image),
      height = artHeight(image);
    if (!width || !height || typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      turnHue(pixels.data, degrees);
      context.putImageData(pixels, 0, 0);
      return canvas;
    } catch {
      return undefined;
    }
  },
};

const artWidth = (image: CanvasImageSource): number =>
  (image as { naturalWidth?: number }).naturalWidth ??
  (image as { width?: number }).width ??
  0;
const artHeight = (image: CanvasImageSource): number =>
  (image as { naturalHeight?: number }).naturalHeight ??
  (image as { height?: number }).height ??
  0;

/** Turns RGBA pixels' hue by `degrees` in place, keeping their lightness (the standard hue-rotation matrix). */
export function turnHue(data: Uint8ClampedArray, degrees: number): void {
  const a = (degrees * Math.PI) / 180,
    cos = Math.cos(a),
    sin = Math.sin(a);
  const m = [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ] as const;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    data[i] = m[0] * r + m[1] * g + m[2] * b;
    data[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    data[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
}
