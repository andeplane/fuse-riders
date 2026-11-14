/**
 * What the renderer needs of a canvas: the handful of 2D context calls it makes, as small interfaces the browser's
 * own `HTMLCanvasElement` and `CanvasRenderingContext2D` satisfy. Tests hand in a typed fake that records the calls.
 */

/** A canvas a sprite is drawn on once and blitted from every frame. */
export interface SpriteCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Pen | null;
}

/** Makes an offscreen canvas of `width` × `height` device pixels. */
export type CanvasFactory = (width: number, height: number) => SpriteCanvas;

/** The canvas the scene draws on. */
export interface SceneCanvas extends SpriteCanvas {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** The part of `CanvasRenderingContext2D` the renderer uses. */
export interface Pen {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  shadowBlur: number;
  shadowColor: string;
  save(): void;
  restore(): void;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    start: number,
    end: number,
    counterclockwise?: boolean,
  ): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  /**
   * The image is always a canvas this renderer made with its `CanvasFactory`; the browser's wider `CanvasImageSource`
   * is named so that the real context fits this interface.
   */
  drawImage(
    image: SpriteCanvas | CanvasImageSource,
    x: number,
    y: number,
  ): void;
  drawImage(
    image: SpriteCanvas | CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}
