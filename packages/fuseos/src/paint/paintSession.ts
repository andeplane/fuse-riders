import type { PaintSnapshot, PaintSurface } from "./paintSurface";
import type { PaintTool, Point, Size } from "./paintTools";
import {
  DEFAULT_CANVAS_SIZE,
  boxBetween,
  isFreehandTool,
  isShapeTool,
} from "./paintTools";

export const MAX_UNDO = 20;

export type StrokeSettings = {
  foreground: string;
  background: string;
  brushSize: number;
};

type ActiveStroke = {
  tool: PaintTool;
  color: string;
  size: number;
  start: Point;
  last: Point;
  before: PaintSnapshot;
};

export type BeginResult = { changed: boolean; picked?: string };

/**
 * The drawing session behind one Paint window: the surface, the undo stack and
 * the stroke in progress. Pure logic over `PaintSurface`, so it runs in tests
 * without a canvas. Holds no React state; the view model mirrors what it needs.
 */
export class PaintSession {
  private surface: PaintSurface | undefined;
  private undoStack: PaintSnapshot[] = [];
  private stroke: ActiveStroke | undefined;

  attach(surface: PaintSurface): void {
    this.surface = surface;
    this.undoStack = [];
    this.stroke = undefined;
  }

  detach(): void {
    this.surface = undefined;
    this.stroke = undefined;
  }

  get isAttached(): boolean {
    return this.surface !== undefined;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  size(): Size {
    return this.surface?.size() ?? DEFAULT_CANVAS_SIZE;
  }

  /** Pointer down: starts a stroke, or applies one-shot tools (fill, picker). The Text tool is placed through `placeText`. */
  begin(
    tool: PaintTool,
    at: Point,
    button: number,
    settings: StrokeSettings,
  ): BeginResult {
    const surface = this.surface;
    if (!surface) return { changed: false };
    const color =
      tool === "eraser"
        ? settings.background
        : button === 2
          ? settings.background
          : settings.foreground;
    if (tool === "picker")
      return { changed: false, picked: surface.colorAt(at) };
    if (tool === "fill") {
      this.push();
      surface.fill(at, color);
      return { changed: true };
    }
    if (tool === "text") return { changed: false };
    const size =
      tool === "pencil"
        ? 1
        : tool === "eraser"
          ? settings.brushSize + 4
          : settings.brushSize;
    const before = this.push();
    this.stroke = { tool, color, size, start: at, last: at, before };
    if (isFreehandTool(tool)) surface.drawLine(at, at, color, size);
    else this.drawShape(at);
    return { changed: true };
  }

  move(at: Point): void {
    const stroke = this.stroke;
    const surface = this.surface;
    if (!stroke || !surface) return;
    if (isFreehandTool(stroke.tool)) {
      surface.drawLine(stroke.last, at, stroke.color, stroke.size);
      stroke.last = at;
      return;
    }
    if (isShapeTool(stroke.tool)) {
      surface.restore(stroke.before);
      this.drawShape(at);
    }
  }

  /** Pointer up; returns whether a stroke was finished. */
  end(at: Point): boolean {
    const stroke = this.stroke;
    if (!stroke) return false;
    if (
      !isFreehandTool(stroke.tool) ||
      at.x !== stroke.last.x ||
      at.y !== stroke.last.y
    )
      this.move(at);
    this.stroke = undefined;
    return true;
  }

  /** Places text (Text tool): one undo step. Returns false, drawing nothing, when the text is blank or nothing is attached. */
  placeText(at: Point, text: string, color: string): boolean {
    const surface = this.surface;
    const trimmed = text.trim();
    if (!surface || trimmed.length === 0) return false;
    this.push();
    surface.drawText(at, trimmed, color);
    return true;
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot || !this.surface) return false;
    this.stroke = undefined;
    this.surface.restore(snapshot);
    return true;
  }

  clear(color: string): void {
    if (!this.surface) return;
    this.push();
    this.surface.clear(color);
  }

  flip(axis: "horizontal" | "vertical"): void {
    if (!this.surface) return;
    this.push();
    this.surface.flip(axis);
  }

  rotate(): void {
    if (!this.surface) return;
    this.push();
    this.surface.rotate();
  }

  /** Blank canvas; forgets the undo history. */
  newImage(size: Size, color: string): void {
    this.undoStack = [];
    this.stroke = undefined;
    this.surface?.reset(size, color);
  }

  /** Draws a decoded file; forgets the undo history. */
  async loadImage(blob: Blob): Promise<Size> {
    if (!this.surface) throw new Error("No canvas to draw on");
    this.undoStack = [];
    this.stroke = undefined;
    return this.surface.loadImage(blob);
  }

  toBlob(mimeType: string): Promise<Blob> {
    if (!this.surface) return Promise.reject(new Error("No canvas to save"));
    return this.surface.toBlob(mimeType);
  }

  toDataUrl(mimeType: string): string | undefined {
    return this.surface?.toDataUrl(mimeType);
  }

  private push(): PaintSnapshot {
    const snapshot = this.surface!.snapshot();
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    return snapshot;
  }

  private drawShape(to: Point): void {
    const stroke = this.stroke;
    const surface = this.surface;
    if (!stroke || !surface) return;
    const box = boxBetween(stroke.start, to);
    switch (stroke.tool) {
      case "line":
        surface.drawLine(stroke.start, to, stroke.color, stroke.size);
        return;
      case "rect":
        surface.drawRect(box, { stroke: stroke.color, size: stroke.size });
        return;
      case "filledRect":
        surface.drawRect(box, {
          stroke: stroke.color,
          fill: stroke.color,
          size: stroke.size,
        });
        return;
      case "ellipse":
        surface.drawEllipse(box, { stroke: stroke.color, size: stroke.size });
        return;
      default:
        return;
    }
  }
}
