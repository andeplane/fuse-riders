import type { Rgba } from "./palette";

export type PaintTool =
  | "pencil"
  | "brush"
  | "eraser"
  | "line"
  | "rect"
  | "filledRect"
  | "ellipse"
  | "fill"
  | "text"
  | "picker";

export const PAINT_TOOLS: readonly {
  tool: PaintTool;
  label: string;
  glyph: string;
}[] = [
  { tool: "pencil", label: "Pencil", glyph: "/" },
  { tool: "brush", label: "Brush", glyph: "●" },
  { tool: "eraser", label: "Eraser", glyph: "▭" },
  { tool: "fill", label: "Fill With Color", glyph: "◆" },
  { tool: "picker", label: "Pick Color", glyph: "✓" },
  { tool: "text", label: "Text", glyph: "A" },
  { tool: "line", label: "Line", glyph: "╲" },
  { tool: "rect", label: "Rectangle", glyph: "□" },
  { tool: "filledRect", label: "Filled Rectangle", glyph: "■" },
  { tool: "ellipse", label: "Ellipse", glyph: "○" },
];

export const BRUSH_SIZES: readonly number[] = [2, 5, 8];
export const DEFAULT_CANVAS_SIZE = { width: 640, height: 400 };

const TOOL_NAMES = new Set<string>(PAINT_TOOLS.map((item) => item.tool));

export function isPaintTool(value: unknown): value is PaintTool {
  return typeof value === "string" && TOOL_NAMES.has(value);
}

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Box = { x: number; y: number; width: number; height: number };

/** The box spanned by two corners, whichever way the user dragged. */
export function boxBetween(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Whether the tool draws a shape previewed while dragging (as opposed to freehand strokes). */
export function isShapeTool(tool: PaintTool): boolean {
  return (
    tool === "line" ||
    tool === "rect" ||
    tool === "filledRect" ||
    tool === "ellipse"
  );
}

export function isFreehandTool(tool: PaintTool): boolean {
  return tool === "pencil" || tool === "brush" || tool === "eraser";
}

/**
 * Scanline flood fill over RGBA pixels, matching the exact colour under `start`.
 * Returns false when nothing changed (outside the image or already that colour).
 */
export function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  start: Point,
  color: Rgba,
): boolean {
  const x0 = Math.floor(start.x);
  const y0 = Math.floor(start.y);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return false;
  const index = (x: number, y: number) => (y * width + x) * 4;
  const origin = index(x0, y0);
  const [red = 0, green = 0, blue = 0, alpha = 0] = pixels.subarray(
    origin,
    origin + 4,
  );
  const target: Rgba = [red, green, blue, alpha];
  if (target.every((channel, position) => channel === color[position]))
    return false;
  const matches = (i: number) =>
    pixels[i] === target[0] &&
    pixels[i + 1] === target[1] &&
    pixels[i + 2] === target[2] &&
    pixels[i + 3] === target[3];
  const paint = (i: number) => {
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  };
  const stack: [number, number][] = [[x0, y0]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (!matches(index(x, y))) continue;
    let left = x;
    while (left > 0 && matches(index(left - 1, y))) left -= 1;
    let right = x;
    while (right < width - 1 && matches(index(right + 1, y))) right += 1;
    for (let px = left; px <= right; px += 1) {
      paint(index(px, y));
      if (y > 0 && matches(index(px, y - 1))) stack.push([px, y - 1]);
      if (y < height - 1 && matches(index(px, y + 1))) stack.push([px, y + 1]);
    }
  }
  return true;
}

export type ImageMimeType = "image/png" | "image/jpeg";

/** File name with the extension that matches the format, e.g. `sketch` + png → `sketch.png`. */
export function fileNameFor(name: string, mimeType: ImageMimeType): string {
  const extension = mimeType === "image/png" ? ".png" : ".jpg";
  const base = name.trim().replace(/\.(png|jpe?g)$/i, "") || "untitled";
  return `${base}${extension}`;
}

export function mimeTypeForName(name: string): ImageMimeType {
  return /\.jpe?g$/i.test(name.trim()) ? "image/jpeg" : "image/png";
}
