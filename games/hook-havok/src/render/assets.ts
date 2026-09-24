export const ASSETS = {
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
export function crops(image: HTMLImageElement, columns = 1, rows = 1): Crop[] {
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
      const left = Math.floor((col * image.width) / columns),
        right = Math.floor(((col + 1) * image.width) / columns);
      const top = Math.floor((row * image.height) / rows),
        bottom = Math.floor(((row + 1) * image.height) / rows);
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
