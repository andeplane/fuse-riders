/** The drawing state a call was made with. */
export interface Style {
  fill: unknown;
  stroke: unknown;
  font: string;
  alpha: number;
  shadowBlur: number;
  lineWidth: number;
}
export interface Call {
  name: string;
  args: unknown[];
  style: Style;
}

/**
 * A Canvas 2D context that records every call with the style it was made in, for the drawing code Node cannot run
 * (`art.ts`, `board.ts`, the screen's board). `save` and `restore` keep the style as a canvas does; text is 7 px a
 * character wide.
 */
export class FakeContext {
  readonly calls: Call[] = [];
  fillStyle: unknown = "#000000";
  strokeStyle: unknown = "#000000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  globalAlpha = 1;
  shadowColor = "transparent";
  shadowBlur = 0;
  shadowOffsetY = 0;
  lineCap = "butt";
  lineJoin = "miter";
  imageSmoothingEnabled = false;
  imageSmoothingQuality = "low";

  /** As the drawing code sees it. */
  get context(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
  private record(name: string, args: unknown[]): void {
    this.calls.push({
      name,
      args,
      style: {
        fill: this.fillStyle,
        stroke: this.strokeStyle,
        font: this.font,
        alpha: this.globalAlpha,
        shadowBlur: this.shadowBlur,
        lineWidth: this.lineWidth,
      },
    });
  }
  /** The calls of one method. */
  named(name: string): Call[] {
    return this.calls.filter((call) => call.name === name);
  }
  /** Every string drawn with `fillText`. */
  texts(): string[] {
    return this.named("fillText").map((call) => String(call.args[0]));
  }
  clear(): void {
    this.calls.length = 0;
  }

  private readonly saved: Partial<FakeContext>[] = [];
  save(): void {
    this.record("save", []);
    const {
      fillStyle,
      strokeStyle,
      lineWidth,
      font,
      textAlign,
      textBaseline,
      globalAlpha,
      shadowColor,
      shadowBlur,
      shadowOffsetY,
    } = this;
    this.saved.push({
      fillStyle,
      strokeStyle,
      lineWidth,
      font,
      textAlign,
      textBaseline,
      globalAlpha,
      shadowColor,
      shadowBlur,
      shadowOffsetY,
    });
  }
  restore(): void {
    this.record("restore", []);
    Object.assign(this, this.saved.pop());
  }
  setTransform(...args: number[]): void {
    this.record("setTransform", args);
  }
  translate(x: number, y: number): void {
    this.record("translate", [x, y]);
  }
  scale(x: number, y: number): void {
    this.record("scale", [x, y]);
  }
  clearRect(...args: number[]): void {
    this.record("clearRect", args);
  }
  fillRect(...args: number[]): void {
    this.record("fillRect", args);
  }
  beginPath(): void {
    this.record("beginPath", []);
  }
  closePath(): void {
    this.record("closePath", []);
  }
  moveTo(x: number, y: number): void {
    this.record("moveTo", [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.record("lineTo", [x, y]);
  }
  arc(...args: number[]): void {
    this.record("arc", args);
  }
  arcTo(...args: number[]): void {
    this.record("arcTo", args);
  }
  ellipse(...args: number[]): void {
    this.record("ellipse", args);
  }
  fill(): void {
    this.record("fill", []);
  }
  stroke(): void {
    this.record("stroke", []);
  }
  clip(): void {
    this.record("clip", []);
  }
  setLineDash(segments: number[]): void {
    this.record("setLineDash", [segments]);
  }
  fillText(text: string, x: number, y: number): void {
    this.record("fillText", [text, x, y]);
  }
  strokeText(text: string, x: number, y: number): void {
    this.record("strokeText", [text, x, y]);
  }
  measureText(text: string): TextMetrics {
    this.record("measureText", [text]);
    return { width: text.length * 7 } as TextMetrics;
  }
  drawImage(...args: unknown[]): void {
    this.record("drawImage", args);
  }
  createRadialGradient(...args: number[]): CanvasGradient {
    this.record("createRadialGradient", args);
    return {
      addColorStop: (offset: number, color: string) =>
        this.record("addColorStop", [offset, color]),
    };
  }
}
