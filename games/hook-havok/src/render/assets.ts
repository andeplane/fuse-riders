export const ASSETS = {
  run: new URL(
    "../../art-source/character/lantern-keeper-run-source.png",
    import.meta.url,
  ).href,
  cathedral: new URL(
    "../../art-source/backgrounds/crossroads-cathedral-source.png",
    import.meta.url,
  ).href,
  shrine: new URL(
    "../../art-source/platforms/lantern-shrine-source.png",
    import.meta.url,
  ).href,
  background: new URL(
    "../../art-source/backgrounds/belfry-background-source.png",
    import.meta.url,
  ).href,
  actor: new URL(
    "../../art-source/character/lantern-keeper-nine-pose-source.png",
    import.meta.url,
  ).href,
  ledge: new URL(
    "../../art-source/platforms/belfry-ledge-source.png",
    import.meta.url,
  ).href,
  hook: new URL("../../art-source/props/brass-hook-source.png", import.meta.url)
    .href,
  lantern: new URL(
    "../../art-source/props/brass-lantern-source.png",
    import.meta.url,
  ).href,
} as const;
export type AssetKey = keyof typeof ASSETS;
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
  pivot: number;
}
/** Source inspection only; preserves PNG pixels and alpha. */
export function crops(
  image: HTMLImageElement,
  columns = 1,
  rows = 1,
  divisions?: { x: readonly number[]; y: readonly number[] },
): Crop[] {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Cannot inspect artwork in this browser.");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  const result: Crop[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const left = Math.floor(
          (divisions?.x[col] ?? col / columns) * image.width,
        ),
        right = Math.floor(
          (divisions?.x[col + 1] ?? (col + 1) / columns) * image.width,
        );
      const top = Math.floor((divisions?.y[row] ?? row / rows) * image.height),
        bottom = Math.floor(
          (divisions?.y[row + 1] ?? (row + 1) / rows) * image.height,
        );
      let x = right,
        y = bottom,
        endX = left,
        endY = top;
      for (let py = top; py < bottom; py++)
        for (let px = left; px < right; px++) {
          if (pixels[(py * image.width + px) * 4 + 3]! > 32) {
            x = Math.min(x, px);
            y = Math.min(y, py);
            endX = Math.max(endX, px);
            endY = Math.max(endY, py);
          }
        }
      if (
        x > endX ||
        y > endY ||
        (columns > 1 &&
          (x === left ||
            endX === right - 1 ||
            y === top ||
            endY === bottom - 1))
      )
        throw new Error("Artwork frames need alignment cleanup.");
      result.push({
        x,
        y,
        width: endX - x + 1,
        height: endY - y + 1,
        pivot: ((left + right) / 2 - x) / (endX - x + 1),
      });
    }
  return result;
}
/**
 * High-quality reduction for artwork drawn far below its source size. Phaser
 * only mipmaps power-of-two textures, so large sources sampled straight down
 * alias into a crunchy look; halving steps keep ink lines smooth.
 */
export function downscale(
  image: HTMLImageElement | HTMLCanvasElement,
  scale: number,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(image.width * scale)),
    height = Math.max(1, Math.round(image.height * scale));
  let current: HTMLImageElement | HTMLCanvasElement = image;
  const step = (w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot prepare artwork in this browser.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, w, h);
    current = canvas;
    return canvas;
  };
  while (current.width / 2 >= width * 1.5)
    step(Math.round(current.width / 2), Math.round(current.height / 2));
  return step(width, height);
}
