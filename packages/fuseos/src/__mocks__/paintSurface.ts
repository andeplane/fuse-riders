import type {
  PaintSnapshot,
  PaintSurface,
  ShapeStyle,
} from "../paint/paintSurface";
import type { Box, Point, Size } from "../paint/paintTools";

/** Records every drawing call as a line of text so tests can assert on what was painted. */
export class FakePaintSurface implements PaintSurface {
  ops: string[] = [];
  width = 640;
  height = 400;
  /** What `colorAt` answers. */
  pixelColor = "#ff0000";
  /** Size reported (and applied) when an image blob is loaded. */
  nextImageSize: Size = { width: 320, height: 200 };
  private readonly snapshots = new WeakMap<PaintSnapshot, string[]>();

  size(): Size {
    return { width: this.width, height: this.height };
  }
  reset(size: Size, color: string): void {
    this.width = size.width;
    this.height = size.height;
    this.ops = [`reset ${size.width}x${size.height} ${color}`];
  }
  clear(color: string): void {
    this.ops.push(`clear ${color}`);
  }
  drawLine(from: Point, to: Point, color: string, size: number): void {
    this.ops.push(`line ${from.x},${from.y}-${to.x},${to.y} ${color} ${size}`);
  }
  drawRect(box: Box, style: ShapeStyle): void {
    this.ops.push(`rect ${boxText(box)} ${styleText(style)}`);
  }
  drawEllipse(box: Box, style: ShapeStyle): void {
    this.ops.push(`ellipse ${boxText(box)} ${styleText(style)}`);
  }
  drawText(at: Point, text: string, color: string): void {
    this.ops.push(`text ${at.x},${at.y} "${text}" ${color}`);
  }
  fill(at: Point, color: string): void {
    this.ops.push(`fill ${at.x},${at.y} ${color}`);
  }
  colorAt(): string {
    return this.pixelColor;
  }
  snapshot(): PaintSnapshot {
    const snapshot: PaintSnapshot = { width: this.width, height: this.height };
    this.snapshots.set(snapshot, [...this.ops]);
    return snapshot;
  }
  restore(snapshot: PaintSnapshot): void {
    const ops = this.snapshots.get(snapshot);
    if (!ops) return;
    this.width = snapshot.width;
    this.height = snapshot.height;
    this.ops = [...ops];
  }
  flip(axis: "horizontal" | "vertical"): void {
    this.ops.push(`flip ${axis}`);
  }
  rotate(): void {
    [this.width, this.height] = [this.height, this.width];
    this.ops.push("rotate");
  }
  async toBlob(mimeType: string): Promise<Blob> {
    return new Blob([this.ops.join("\n")], { type: mimeType });
  }
  toDataUrl(mimeType: string): string {
    return `data:${mimeType};base64,FAKE`;
  }
  async loadImage(blob: Blob): Promise<Size> {
    this.width = this.nextImageSize.width;
    this.height = this.nextImageSize.height;
    this.ops = [`image ${blob.type || "blob"} ${this.width}x${this.height}`];
    return this.size();
  }
}

function boxText(box: Box): string {
  return `${box.x},${box.y} ${box.width}x${box.height}`;
}

function styleText(style: ShapeStyle): string {
  return `${style.stroke ?? "-"}/${style.fill ?? "-"} ${style.size}`;
}
