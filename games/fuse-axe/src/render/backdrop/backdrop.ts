import { CAMERA_END_PX, VIEW_W } from "../../engine/view-kit.js";
import { ASHEN_VILLAGE } from "./ashen-village.js";
import { Raster, type Brush, type LayerArt, type StageArt } from "./kit.js";

/**
 * A stage's parallax backdrop at the native 320 × 180. Each static layer is painted once into a pixel buffer and
 * handed to `make`, which turns it into whatever surface the renderer blits (in the browser an `OffscreenCanvas`:
 * `(w, h, rgba) => { const c = new OffscreenCanvas(w, h); c.getContext("2d")!.putImageData(new ImageData(rgba, w, h),
 * 0, 0); return c; }`). A frame then blits each layer at a whole-pixel offset and paints only the fires.
 */
export interface Pen<S> extends Brush {
  drawImage(
    image: S,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Turns a painted layer (`width` × `height` RGBA, rows top to bottom) into a surface the pen can blit. */
export type MakeSurface<S> = (
  width: number,
  height: number,
  rgba: Uint8ClampedArray<ArrayBuffer>,
) => S;

export interface Backdrop<S> {
  /**
   * Everything behind the heroes: call first each frame, with image smoothing off so the whole-pixel blits stay sharp.
   * `frame` counts 60 Hz steps and only moves the fires; the pen's `fillStyle` is left as it was found.
   */
  draw(pen: Pen<S>, camX: number, frame: number): void;
  /** The foreground in front of the heroes: call after them. */
  drawFront(pen: Pen<S>, camX: number): void;
}

export type StageNumber = 1;

const STAGES: Record<StageNumber, StageArt> = { 1: ASHEN_VILLAGE };

interface Baked<S> {
  surface: S;
  rate: readonly [number, number];
  top: number;
  height: number;
}

function bake<S>(make: MakeSurface<S>, layer: LayerArt): Baked<S> {
  const [num, den] = layer.rate;
  const raster = new Raster(
    VIEW_W + Math.floor((CAMERA_END_PX * num) / den),
    layer.top,
    layer.height,
  );
  layer.paint(raster);
  return {
    surface: make(raster.width, raster.height, raster.rgba),
    rate: layer.rate,
    top: layer.top,
    height: layer.height,
  };
}

function blit<S>(pen: Pen<S>, layer: Baked<S>, camX: number) {
  const sx = Math.floor((camX * layer.rate[0]) / layer.rate[1]);
  pen.drawImage(
    layer.surface,
    sx,
    0,
    VIEW_W,
    layer.height,
    0,
    layer.top,
    VIEW_W,
    layer.height,
  );
}

/** The camera in whole pixels, held to the stage so no layer is sampled past its end. */
const camera = (camX: number) =>
  Number.isFinite(camX)
    ? Math.min(Math.max(Math.floor(camX), 0), CAMERA_END_PX)
    : 0;

/** The fires' clock: a step count that is never negative or NaN, so no flame or ember gets an invalid colour. */
const clock = (frame: number) =>
  Number.isFinite(frame) ? Math.max(frame, 0) : 0;

export function createBackdrop<S>(
  make: MakeSurface<S>,
  stage: StageNumber,
): Backdrop<S> {
  if (!Object.hasOwn(STAGES, stage))
    throw new RangeError(`no backdrop for stage ${String(stage)}`);
  const art = STAGES[stage];
  const back = art.back.map((layer) => bake(make, layer));
  const front = bake(make, art.front);
  return {
    draw(pen, camX, frame) {
      const cam = camera(camX);
      for (const layer of back) blit(pen, layer, cam);
      const style = pen.fillStyle;
      art.animate(pen, cam, clock(frame));
      pen.fillStyle = style;
    },
    drawFront(pen, camX) {
      blit(pen, front, camera(camX));
    },
  };
}
