import type {
  CanvasSurfaceDeps,
  DecodedImage,
  PaintCanvas,
  PaintContext2D,
} from "./paintSurface";
import { browserCanvasDeps, createCanvasSurface } from "./paintSurface";

/** A canvas that encodes to a fixed data url and blob, and remembers its size. */
class FakeCanvas implements PaintCanvas {
  width = 4;
  height = 3;
  encoded: { type: string; quality: number }[] = [];
  /** When false `toBlob` hands back null, as a browser does for an unsupported type. */
  encodes = true;

  toBlob(
    callback: (blob: Blob | null) => void,
    type: string,
    quality: number,
  ): void {
    this.encoded.push({ type, quality });
    callback(this.encodes ? new Blob(["png"], { type }) : null);
  }

  toDataURL(type: string, quality: number): string {
    this.encoded.push({ type, quality });
    return `data:${type};q=${quality}`;
  }
}

/** A 2D context over a flat RGBA buffer: fills and image data are real, everything else is recorded. */
class FakeContext implements PaintContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  font = "";
  textBaseline: CanvasTextBaseline = "alphabetic";
  ops: string[] = [];
  pixels: Uint8ClampedArray;

  constructor(private readonly canvas: PaintCanvas) {
    this.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  private sync(): void {
    const size = this.canvas.width * this.canvas.height * 4;
    if (this.pixels.length !== size) this.pixels = new Uint8ClampedArray(size);
  }

  private rgb(): [number, number, number] {
    const hex = String(this.fillStyle).replace("#", "");
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.sync();
    this.ops.push(
      `fillRect ${x} ${y} ${width} ${height} ${String(this.fillStyle)}`,
    );
    const [r, g, b] = this.rgb();
    for (let row = y; row < Math.min(y + height, this.canvas.height); row++)
      for (let col = x; col < Math.min(x + width, this.canvas.width); col++) {
        const at = (row * this.canvas.width + col) * 4;
        this.pixels.set([r, g, b, 255], at);
      }
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.ops.push(
      `strokeRect ${x} ${y} ${width} ${height} ${String(this.strokeStyle)} ${this.lineWidth} ${this.lineJoin}`,
    );
  }

  beginPath(): void {
    this.ops.push("beginPath");
  }

  moveTo(x: number, y: number): void {
    this.ops.push(`moveTo ${x} ${y}`);
  }

  lineTo(x: number, y: number): void {
    this.ops.push(`lineTo ${x} ${y}`);
  }

  stroke(): void {
    this.ops.push(
      `stroke ${String(this.strokeStyle)} ${this.lineWidth} ${this.lineCap} ${this.lineJoin}`,
    );
  }

  fill(): void {
    this.ops.push(`fill ${String(this.fillStyle)}`);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void {
    this.ops.push(
      `ellipse ${x} ${y} ${radiusX} ${radiusY} ${rotation} ${startAngle} ${endAngle.toFixed(2)}`,
    );
  }

  fillText(text: string, x: number, y: number): void {
    this.ops.push(
      `fillText "${text}" ${x} ${y} ${String(this.fillStyle)} ${this.font} ${this.textBaseline}`,
    );
  }

  getImageData(x: number, y: number, width: number, height: number): ImageData {
    this.sync();
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const from = ((y + row) * this.canvas.width + (x + col)) * 4;
        data.set(this.pixels.subarray(from, from + 4), (row * width + col) * 4);
      }
    return { data, width, height, colorSpace: "srgb" };
  }

  putImageData(image: ImageData, dx: number, dy: number): void {
    this.sync();
    this.ops.push(`putImageData ${image.width}x${image.height} ${dx} ${dy}`);
    for (let row = 0; row < image.height; row++)
      for (let col = 0; col < image.width; col++) {
        const to = ((dy + row) * this.canvas.width + (dx + col)) * 4;
        if (to + 4 > this.pixels.length) continue;
        const from = (row * image.width + col) * 4;
        this.pixels.set(image.data.subarray(from, from + 4), to);
      }
  }

  save(): void {
    this.ops.push("save");
  }

  restore(): void {
    this.ops.push("restore");
  }

  translate(x: number, y: number): void {
    this.ops.push(`translate ${x} ${y}`);
  }

  scale(x: number, y: number): void {
    this.ops.push(`scale ${x} ${y}`);
  }

  rotate(angle: number): void {
    this.ops.push(`rotate ${angle.toFixed(3)}`);
  }

  drawImage(image: CanvasImageSource | PaintCanvas, dx: number, dy: number) {
    const size =
      "width" in image && typeof image.width === "number"
        ? `${image.width}x${String(image.height)}`
        : "image";
    this.ops.push(`drawImage ${size} ${dx} ${dy}`);
  }
}

function harness(decoded?: DecodedImage) {
  const canvas = new FakeCanvas();
  const contexts = new Map<PaintCanvas, FakeContext>();
  const copies: FakeCanvas[] = [];
  const deps: CanvasSurfaceDeps = {
    context: (target) => {
      const existing = contexts.get(target);
      if (existing) return existing;
      const created = new FakeContext(target);
      contexts.set(target, created);
      return created;
    },
    createCanvas: () => {
      const copy = new FakeCanvas();
      copies.push(copy);
      return copy;
    },
    decode: () =>
      decoded
        ? Promise.resolve(decoded)
        : Promise.reject(new Error("no decoder")),
  };
  const surface = createCanvasSurface(canvas, deps);
  const context = contexts.get(canvas);
  if (!context) throw new Error("the surface asked for no context");
  return { surface, canvas, context, copies, contexts };
}

describe(createCanvasSurface.name, () => {
  it("starts white at the canvas size, resets to a new size and colour, and clears", () => {
    const { surface, canvas, context } = harness();
    expect(context.ops).toEqual(["fillRect 0 0 4 3 #ffffff"]);
    expect(surface.size()).toEqual({ width: 4, height: 3 });
    expect(surface.colorAt({ x: 0, y: 0 })).toBe("#ffffff");

    surface.reset({ width: 2.4, height: 0.2 }, "#ff0000");
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(1);
    expect(surface.colorAt({ x: 1, y: 0 })).toBe("#ff0000");
    surface.clear("#00ff00");
    expect(surface.colorAt({ x: 9, y: 9 })).toBe("#00ff00");
    // A point off the canvas reads the nearest edge pixel; a negative one the first.
    expect(surface.colorAt({ x: -5, y: -5 })).toBe("#00ff00");
  });

  it("refuses a canvas without a 2D context", () => {
    const deps: CanvasSurfaceDeps = {
      context: () => null,
      createCanvas: () => new FakeCanvas(),
      decode: () => Promise.reject(new Error("unused")),
    };
    expect(() => createCanvasSurface(new FakeCanvas(), deps)).toThrow(
      "Canvas 2D is not available",
    );
  });

  it("strokes lines round-capped, rectangles and ellipses with their fill and stroke, and text on the top baseline", () => {
    const { surface, context } = harness();
    context.ops.length = 0;
    surface.drawLine({ x: 1, y: 1 }, { x: 3, y: 2 }, "#123456", 3);
    expect(context.ops).toEqual([
      "beginPath",
      "moveTo 1 1",
      "lineTo 3 2",
      "stroke #123456 3 round round",
    ]);

    context.ops.length = 0;
    surface.drawRect(
      { x: 0, y: 0, width: 2, height: 2 },
      { fill: "#00ff00", stroke: "#000000", size: 2 },
    );
    expect(context.ops).toEqual([
      "fillRect 0 0 2 2 #00ff00",
      "strokeRect 0 0 2 2 #000000 2 miter",
    ]);
    context.ops.length = 0;
    surface.drawRect({ x: 0, y: 0, width: 2, height: 2 }, { size: 1 });
    expect(context.ops).toEqual([]);

    surface.drawEllipse(
      { x: 0, y: 0, width: 4, height: 2 },
      { fill: "#ff00ff", stroke: "#0000ff", size: 1 },
    );
    expect(context.ops).toEqual([
      "beginPath",
      `ellipse 2 1 2 1 0 0 ${(Math.PI * 2).toFixed(2)}`,
      "fill #ff00ff",
      // The line join is whatever the last rectangle left (miter); the cap stays from the line.
      "stroke #0000ff 1 round miter",
    ]);
    context.ops.length = 0;
    surface.drawEllipse({ x: 0, y: 0, width: 4, height: 2 }, { size: 1 });
    expect(context.ops).toEqual([
      "beginPath",
      `ellipse 2 1 2 1 0 0 ${(Math.PI * 2).toFixed(2)}`,
    ]);

    context.ops.length = 0;
    surface.drawText({ x: 1, y: 2 }, "hi", "#000000");
    surface.drawText({ x: 1, y: 2 }, "hi", "#000000", "10px serif");
    expect(context.ops).toEqual([
      'fillText "hi" 1 2 #000000 16px "Pixelated MS Sans Serif", Arial, sans-serif top',
      'fillText "hi" 1 2 #000000 10px serif top',
    ]);
  });

  it("flood fills the region under the point and leaves the canvas alone when the colour is already there", () => {
    const { surface, context } = harness();
    surface.reset({ width: 4, height: 1 }, "#ffffff");
    surface.drawRect(
      { x: 2, y: 0, width: 1, height: 1 },
      { fill: "#000000", size: 1 },
    );
    context.ops.length = 0;
    surface.fill({ x: 0, y: 0 }, "#ff0000");
    expect(context.ops).toEqual(["putImageData 4x1 0 0"]);
    expect(surface.colorAt({ x: 1, y: 0 })).toBe("#ff0000");
    expect(surface.colorAt({ x: 2, y: 0 })).toBe("#000000");
    expect(surface.colorAt({ x: 3, y: 0 })).toBe("#ffffff");
    context.ops.length = 0;
    surface.fill({ x: 0, y: 0 }, "#ff0000");
    expect(context.ops).toEqual([]);
  });

  it("snapshots the pixels and restores them, resizing the canvas back when it changed in between", () => {
    const { surface, canvas, context } = harness();
    surface.clear("#0000ff");
    const before = surface.snapshot();
    expect(before).toEqual({ width: 4, height: 3 });
    surface.reset({ width: 2, height: 2 }, "#00ff00");
    surface.restore(before);
    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(3);
    expect(surface.colorAt({ x: 3, y: 2 })).toBe("#0000ff");
    context.ops.length = 0;
    // A snapshot from another surface has no pixels here: nothing happens.
    surface.restore({ width: 1, height: 1 });
    expect(context.ops).toEqual([]);
  });

  it("flips and rotates by drawing a copy of itself under a transform", () => {
    const { surface, canvas, context, copies, contexts } = harness();
    context.ops.length = 0;
    surface.flip("horizontal");
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ width: 4, height: 3 });
    expect(contexts.get(copies[0] ?? canvas)?.ops).toEqual([
      "drawImage 4x3 0 0",
    ]);
    expect(context.ops).toEqual([
      "save",
      "translate 4 0",
      "scale -1 1",
      "drawImage 4x3 0 0",
      "restore",
    ]);

    context.ops.length = 0;
    surface.flip("vertical");
    expect(context.ops).toEqual([
      "save",
      "translate 0 3",
      "scale 1 -1",
      "drawImage 4x3 0 0",
      "restore",
    ]);

    context.ops.length = 0;
    surface.rotate();
    expect(surface.size()).toEqual({ width: 3, height: 4 });
    expect(context.ops).toEqual([
      "save",
      "translate 3 0",
      `rotate ${(Math.PI / 2).toFixed(3)}`,
      "drawImage 4x3 0 0",
      "restore",
    ]);
  });

  it("encodes to a blob or a data url at Paint's quality, and says when the browser cannot", async () => {
    const { surface, canvas } = harness();
    await expect(surface.toBlob("image/png")).resolves.toBeInstanceOf(Blob);
    expect(surface.toDataUrl("image/jpeg")).toBe("data:image/jpeg;q=0.85");
    expect(canvas.encoded).toEqual([
      { type: "image/png", quality: 0.92 },
      { type: "image/jpeg", quality: 0.85 },
    ]);
    canvas.encodes = false;
    await expect(surface.toBlob("image/webp")).rejects.toThrow(
      "Could not encode the image",
    );
  });

  it("loads a decoded picture at its own size and releases it, even when drawing fails", async () => {
    const released: number[] = [];
    const picture = new FakeCanvas();
    picture.width = 7;
    picture.height = 5;
    const { surface, context } = harness({
      source: picture,
      width: 7,
      height: 5,
      release: () => released.push(1),
    });
    context.ops.length = 0;
    await expect(surface.loadImage(new Blob(["x"]))).resolves.toEqual({
      width: 7,
      height: 5,
    });
    expect(context.ops).toEqual([
      "fillRect 0 0 7 5 #ffffff",
      "drawImage 7x5 0 0",
    ]);
    expect(released).toEqual([1]);

    const failing = harness();
    await expect(failing.surface.loadImage(new Blob(["x"]))).rejects.toThrow(
      "no decoder",
    );
  });

  it("ships browser deps that read a real canvas's context and make detached copies", () => {
    const element = document.createElement("canvas");
    // happy-dom has no 2D rasteriser: the context is whatever the element answers, null included.
    expect(() => browserCanvasDeps.context(element)).not.toThrow();
    expect(browserCanvasDeps.context(new FakeCanvas())).toBeNull();
    const copy = browserCanvasDeps.createCanvas();
    expect(copy).toBeInstanceOf(HTMLCanvasElement);
  });
});
