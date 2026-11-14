import type { SceneArt } from "../render/scene.js";

/**
 * The generated art (`docs/design/fuse-volley-art.md`), loaded in the background. The scene asks for it every frame
 * and draws its procedural fallback for anything not here yet, so a slow or failed download never holds a match up.
 */
export interface ImageLoader {
  /** Resolves with the decoded image, or undefined when it cannot be loaded. */
  load(url: string): Promise<CanvasImageSource | undefined>;
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
  const got: Partial<Record<keyof typeof ART_FILES, CanvasImageSource>> = {};
  const update = () => {
    art = {
      ...(got.court ? { court: got.court } : {}),
      ...(got.ball ? { ball: got.ball } : {}),
      ...(got.cyan || got.pink ? { blobs: [got.cyan, got.pink] as const } : {}),
    };
  };
  for (const key of Object.keys(ART_FILES) as (keyof typeof ART_FILES)[])
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
