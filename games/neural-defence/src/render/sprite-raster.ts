import { NEURON_ART, structureArt } from "./art.js";

type Sprites = Readonly<Record<string, string>>;
export interface SpriteRasterizer {
  resize(url: string, maximumSide: number): Promise<string>;
}
export interface BuildingSprites {
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
  const variants = new Map<string, string | null>();
  return {
    resolve(pixelsPerUnit) {
      const size = spriteRasterSize(pixelsPerUnit);
      if (size === null) return sprites;
      const result = { ...sprites };
      for (const name of names) {
        const url = sprites[name];
        if (!url) continue;
        const key = `${name}:${size}`;
        if (!variants.has(key)) {
          // Pending and failed requests retain originals and are never retried.
          variants.set(key, null);
          void rasterizer.resize(url, size).then(
            (resized) => variants.set(key, resized),
            () => {},
          );
        }
        result[name] = variants.get(key) ?? url;
      }
      return result;
    },
  };
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
