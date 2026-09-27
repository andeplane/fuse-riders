import { NEURON_ART, structureArt, teamArtHue } from "./art.js";

type Sprites = Readonly<Record<string, string>>;
export interface SpriteRasterizer {
  resize(
    url: string,
    maximumSide: number,
    tint?: number | "shadow",
  ): Promise<string>;
}
export type SpritePaint = "shadow" | "team-0" | "team-1" | "team-2" | "team-3";
export function teamSpritePaint(slot: number): SpritePaint {
  return (["team-0", "team-1", "team-2", "team-3"] as const)[slot] ?? "team-0";
}
export function paintedSpriteKey(name: string, paint: SpritePaint): string {
  return `${name}:${paint}`;
}
export interface BuildingSprites {
  /** Stable identity until this tier's artwork changes. */
  resolve(pixelsPerUnit: number, slots?: readonly number[]): Sprites;
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
  const requested = new Set<string>();
  return {
    resolve(pixelsPerUnit, slots = []) {
      const size = spriteRasterSize(pixelsPerUnit);
      if (size === null) return sprites;
      if (!tiers.has(size)) tiers.set(size, { ...sprites });
      const paints: SpritePaint[] = slots.length
        ? [
            ...new Set(
              slots
                .filter((slot) => [0, 1, 2, 3].includes(slot))
                .map(teamSpritePaint),
            ),
            "shadow",
          ]
        : [];
      for (const name of names) {
        const url = sprites[name];
        if (!url) continue;
        for (const paint of [undefined, ...paints]) {
          const key = paint ? paintedSpriteKey(name, paint) : name;
          const request = `${size}:${key}`;
          if (requested.has(request)) continue;
          requested.add(request);
          const tint =
            paint === "shadow"
              ? "shadow"
              : paint
                ? teamArtHue(Number(paint.slice(-1)))
                : undefined;
          void rasterizer.resize(url, size, tint).then(
            (resized) =>
              tiers.set(size, { ...tiers.get(size)!, [key]: resized }),
            () => {},
          );
        }
      }
      return tiers.get(size)!;
    },
  };
}

/** Refresh only image sources; preserve animated groups and their current phase. */
export function refreshSpriteImages(root: Element, sprites: Sprites): void {
  for (const image of root.querySelectorAll("image[data-sprite]")) {
    const name = image.getAttribute("data-sprite")!;
    const paint = image.getAttribute("data-sprite-paint") as SpritePaint | null;
    const painted = paint ? sprites[paintedSpriteKey(name, paint)] : undefined;
    const url = painted ?? sprites[`${name}-v2`] ?? sprites[name];
    if (url && image.getAttribute("href") !== url)
      image.setAttribute("href", url);
    const filter = image.getAttribute("data-sprite-filter");
    if (filter) {
      const desired = painted ? "none" : filter;
      if (image.parentElement?.getAttribute("filter") !== desired)
        image.parentElement?.setAttribute("filter", desired);
    }
  }
}

/** Browser capability supplied at the composition root; no gameplay state. */
export function createBrowserSpriteRasterizer(
  document: Document,
  createImage: () => HTMLImageElement,
): SpriteRasterizer {
  const sources = new Map<string, Promise<HTMLImageElement>>();
  const rasters = new Map<
    string,
    Promise<{ url: string; width: number; height: number }>
  >();
  const load = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = createImage();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Sprite could not be loaded"));
      image.src = url;
    });
  return {
    async resize(url, maximumSide, tint) {
      let pending = sources.get(url);
      if (!pending) {
        pending = load(url);
        sources.set(url, pending);
      }
      const image = await pending;
      const key = `${maximumSide}:${url}`;
      let raster = rasters.get(key);
      if (!raster) {
        raster = Promise.resolve().then(() => {
          const scale = Math.min(
            1,
            maximumSide / Math.max(image.naturalWidth, image.naturalHeight),
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Sprite canvas unavailable");
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return {
            url: canvas.toDataURL("image/png"),
            width: canvas.width,
            height: canvas.height,
          };
        });
        rasters.set(key, raster);
      }
      const base = await raster;
      if (tint === undefined || tint === 0) return base.url;
      // Bake the existing native SVG sRGB matrix once, using a self-contained
      // embedded PNG, so the live board need not filter every animation frame.
      const matrix =
        tint === "shadow"
          ? '<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/>'
          : `<feColorMatrix type="hueRotate" values="${tint}"/>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${base.width}" height="${base.height}"><defs><filter id="tint" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${matrix}</filter></defs><image href="${base.url}" width="${base.width}" height="${base.height}" filter="url(#tint)"/></svg>`;
      const painted = await load(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      );
      const canvas = document.createElement("canvas");
      canvas.width = base.width;
      canvas.height = base.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Sprite canvas unavailable");
      context.drawImage(painted, 0, 0);
      return canvas.toDataURL("image/png");
    },
  };
}
