import { NEURON_ART, structureArt } from "./art.js";

type Sprites = Readonly<Record<string, string>>;
export interface SpriteRasterizer {
  resize(url: string, maximumSide: number): Promise<string>;
}
export interface BuildingSprites {
  /** Stable identity until this tier's artwork changes. */
  resolve(pixelsPerUnit: number): Sprites;
}

/** Keep original art at close zoom; only four smaller, bounded variants exist. */
export function spriteRasterSize(pixelsPerUnit: number): number | null {
  const required = Math.ceil(96 * pixelsPerUnit);
  if (!Number.isFinite(required) || required <= 0) return null;
  return [128, 256, 512, 1024].find((size) => size >= required) ?? null;
}

export function createBuildingSprites(
  sprites: Sprites,
  rasterizer: SpriteRasterizer,
): BuildingSprites {
  const names = [
    ...NEURON_ART,
    ...(
      ["brain", "tower", "siege", "relay", "bastion", "harvester"] as const
    ).map((kind) => structureArt(kind)),
  ];
  const tiers = new Map<number, Sprites>();
  return {
    resolve(pixelsPerUnit) {
      const size = spriteRasterSize(pixelsPerUnit);
      if (size === null) return sprites;
      const cached = tiers.get(size);
      if (cached) return cached;
      const result = { ...sprites };
      tiers.set(size, result);
      for (const name of names) {
        const url = sprites[name];
        if (!url) continue;
        // The tier is installed before requests start: pending/failed requests
        // retain original art without retrying. Ready tiers change atomically.
        void rasterizer.resize(url, size).then(
          (resized) =>
            tiers.set(size, { ...tiers.get(size)!, [name]: resized }),
          () => {},
        );
      }
      return result;
    },
  };
}

/** Refresh only image sources; preserve animated groups and their current phase. */
export function refreshSpriteImages(root: Element, sprites: Sprites): void {
  for (const image of root.querySelectorAll("image[data-sprite]")) {
    const name = image.getAttribute("data-sprite")!;
    const url = sprites[`${name}-v2`] ?? sprites[name];
    if (url && image.getAttribute("href") !== url)
      image.setAttribute("href", url);
  }
}

/** Browser capability supplied at the composition root; no gameplay state. */
export function createBrowserSpriteRasterizer(
  document: Document,
  createImage: () => HTMLImageElement,
): SpriteRasterizer {
  const sources = new Map<string, Promise<HTMLImageElement>>();
  return {
    async resize(url, maximumSide) {
      let pending = sources.get(url);
      if (!pending) {
        pending = new Promise<HTMLImageElement>((resolve, reject) => {
          const image = createImage();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Sprite could not be loaded"));
          image.src = url;
        });
        sources.set(url, pending);
      }
      const image = await pending;
      const scale =
        maximumSide / Math.max(image.naturalWidth, image.naturalHeight);
      if (scale >= 1) return url;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return url;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    },
  };
}
