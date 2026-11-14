import type { Box, Point, Size } from "./paintTools";
import { floodFill } from "./paintTools";
import { parseHexColor, toHexColor } from "./palette";

/** Opaque handle to a copy of the pixels, for undo and shape previews. */
export interface PaintSnapshot {
  readonly width: number;
  readonly height: number;
}

export type ShapeStyle = { stroke?: string; fill?: string; size: number };

/**
 * Everything Paint does to pixels. Implemented over a real canvas in the app
 * and by a recording fake in tests, so view models never touch the 2D context.
 */
export interface PaintSurface {
  size(): Size;
  /** New canvas of the given size filled with `color`. */
  reset(size: Size, color: string): void;
  clear(color: string): void;
  drawLine(from: Point, to: Point, color: string, size: number): void;
  drawRect(box: Box, style: ShapeStyle): void;
  drawEllipse(box: Box, style: ShapeStyle): void;
  drawText(at: Point, text: string, color: string, font?: string): void;
  fill(at: Point, color: string): void;
  colorAt(at: Point): string;
  snapshot(): PaintSnapshot;
  restore(snapshot: PaintSnapshot): void;
  flip(axis: "horizontal" | "vertical"): void;
  /** Rotates 90 degrees clockwise; width and height swap. */
  rotate(): void;
  toBlob(mimeType: string): Promise<Blob>;
  toDataUrl(mimeType: string): string;
  /** Decodes an image, resizes the surface to it and draws it. */
  loadImage(blob: Blob): Promise<Size>;
}

const TEXT_FONT = '16px "Pixelated MS Sans Serif", Arial, sans-serif';

function decode(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode the image"));
    };
    image.src = url;
  });
}

class CanvasPaintSurface implements PaintSurface {
  private readonly context: CanvasRenderingContext2D;
  private readonly pixels = new WeakMap<PaintSnapshot, ImageData>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
    this.clear("#ffffff");
  }

  size(): Size {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  reset(size: Size, color: string): void {
    this.canvas.width = Math.max(1, Math.round(size.width));
    this.canvas.height = Math.max(1, Math.round(size.height));
    this.clear(color);
  }

  clear(color: string): void {
    this.context.fillStyle = color;
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawLine(from: Point, to: Point, color: string, size: number): void {
    const context = this.context;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  drawRect(box: Box, style: ShapeStyle): void {
    const context = this.context;
    if (style.fill) {
      context.fillStyle = style.fill;
      context.fillRect(box.x, box.y, box.width, box.height);
    }
    if (style.stroke) {
      context.strokeStyle = style.stroke;
      context.lineWidth = style.size;
      context.lineJoin = "miter";
      context.strokeRect(box.x, box.y, box.width, box.height);
    }
  }

  drawEllipse(box: Box, style: ShapeStyle): void {
    const context = this.context;
    context.beginPath();
    context.ellipse(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width / 2,
      box.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    if (style.fill) {
      context.fillStyle = style.fill;
      context.fill();
    }
    if (style.stroke) {
      context.strokeStyle = style.stroke;
      context.lineWidth = style.size;
      context.stroke();
    }
  }

  drawText(at: Point, text: string, color: string, font?: string): void {
    const context = this.context;
    context.font = font ?? TEXT_FONT;
    context.textBaseline = "top";
    context.fillStyle = color;
    context.fillText(text, at.x, at.y);
  }

  fill(at: Point, color: string): void {
    const { width, height } = this.size();
    const image = this.context.getImageData(0, 0, width, height);
    if (floodFill(image.data, width, height, at, parseHexColor(color)))
      this.context.putImageData(image, 0, 0);
  }

  colorAt(at: Point): string {
    const x = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(at.x)));
    const y = Math.max(0, Math.min(this.canvas.height - 1, Math.floor(at.y)));
    const [r = 0, g = 0, b = 0] = this.context.getImageData(x, y, 1, 1).data;
    return toHexColor(r, g, b);
  }

  snapshot(): PaintSnapshot {
    const { width, height } = this.size();
    const snapshot: PaintSnapshot = { width, height };
    this.pixels.set(snapshot, this.context.getImageData(0, 0, width, height));
    return snapshot;
  }

  restore(snapshot: PaintSnapshot): void {
    const image = this.pixels.get(snapshot);
    if (!image) return;
    if (
      snapshot.width !== this.canvas.width ||
      snapshot.height !== this.canvas.height
    ) {
      this.canvas.width = snapshot.width;
      this.canvas.height = snapshot.height;
    }
    this.context.putImageData(image, 0, 0);
  }

  flip(axis: "horizontal" | "vertical"): void {
    const copy = this.copy();
    const { width, height } = this.size();
    const context = this.context;
    context.save();
    if (axis === "horizontal") {
      context.translate(width, 0);
      context.scale(-1, 1);
    } else {
      context.translate(0, height);
      context.scale(1, -1);
    }
    context.drawImage(copy, 0, 0);
    context.restore();
  }

  rotate(): void {
    const copy = this.copy();
    const { width, height } = this.size();
    this.canvas.width = height;
    this.canvas.height = width;
    const context = this.context;
    context.save();
    context.translate(height, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(copy, 0, 0);
    context.restore();
  }

  toBlob(mimeType: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not encode the image")),
        mimeType,
        0.92,
      );
    });
  }

  toDataUrl(mimeType: string): string {
    return this.canvas.toDataURL(mimeType, 0.85);
  }

  async loadImage(blob: Blob): Promise<Size> {
    const decoded = await decode(blob);
    try {
      this.reset({ width: decoded.width, height: decoded.height }, "#ffffff");
      this.context.drawImage(decoded.source, 0, 0);
    } finally {
      decoded.release();
    }
    return this.size();
  }

  private copy(): HTMLCanvasElement {
    const copy = document.createElement("canvas");
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext("2d")?.drawImage(this.canvas, 0, 0);
    return copy;
  }
}

export function createCanvasSurface(canvas: HTMLCanvasElement): PaintSurface {
  return new CanvasPaintSurface(canvas);
}
