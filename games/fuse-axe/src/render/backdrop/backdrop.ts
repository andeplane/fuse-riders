import { cameraEndPx, VIEW_W } from "../../engine/view-kit.js";
import { pixelSurface, type MakeSurface } from "../surface.js";
import { ASHEN_VILLAGE } from "./ashen-village.js";
import { CAMP_ART } from "./camp.js";
import { Raster, type Brush, type LayerArt, type StageArt } from "./kit.js";
import { WYRMBONE_PASS } from "./wyrmbone-pass.js";

/**
 * A stage's parallax backdrop at the native 320 × 180. Each static layer is painted once into a pixel buffer and
 * copied into a surface from the renderer's one factory (`../surface.ts`), through its `putPixels` fast path when it
 * has one. A frame then blits each layer at a whole-pixel offset and paints only the fires.
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

export interface Backdrop<S> {
  /**
   * Everything behind the heroes: call first each frame, with image smoothing off so the whole-pixel blits stay sharp.
   * `frame` counts 60 Hz steps and only moves the fires; the pen's `fillStyle` is left as it was found.
   */
  draw(pen: Pen<S>, camX: number, frame: number): void;
  /** The foreground in front of the heroes: call after them. */
  drawFront(pen: Pen<S>, camX: number): void;
}

/** The stages with art of their own, so far Ashen Village's and Wyrmbone Pass's. */
export type StageNumber = 1 | 2;

const STAGES: Record<StageNumber, StageArt> = {
  1: ASHEN_VILLAGE,
  2: WYRMBONE_PASS,
};

/** Whether `stage` has a backdrop of its own; one that has none is drawn on Stage 1's (`createScene`). */
export const hasBackdrop = (stage: number): stage is StageNumber =>
  Object.hasOwn(STAGES, stage);

interface Baked<S> {
  surface: S;
  rate: readonly [number, number];
  top: number;
  height: number;
}

/** A layer painted as wide as it scrolls across the stage, to the camera's furthest point `end`. */
function bake<S>(make: MakeSurface<S>, layer: LayerArt, end: number): Baked<S> {
  const [num, den] = layer.rate;
  const raster = new Raster(
    VIEW_W + Math.floor((end * num) / den),
    layer.top,
    layer.height,
  );
  layer.paint(raster);
  return {
    surface: pixelSurface(make, raster.width, raster.height, raster.rgba),
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
const camera = (camX: number, end: number) =>
  Number.isFinite(camX) ? Math.min(Math.max(Math.floor(camX), 0), end) : 0;

/** The fires' clock: a step count that is never negative or NaN, so no flame or ember gets an invalid colour. */
const clock = (frame: number) =>
  Number.isFinite(frame) ? Math.max(frame, 0) : 0;

export function createBackdrop<S>(
  make: MakeSurface<S>,
  stage: StageNumber,
): Backdrop<S> {
  if (!hasBackdrop(stage))
    throw new RangeError(`no backdrop for stage ${String(stage)}`);
  return fromArt(make, STAGES[stage], cameraEndPx(stage));
}

/** Camp's backdrop between stages: one screen, whose camera never moves. */
export const createCampBackdrop = <S>(make: MakeSurface<S>): Backdrop<S> =>
  fromArt(make, CAMP_ART, 0);

/** A backdrop of `art` baked for a camera that goes as far as `end`. */
function fromArt<S>(
  make: MakeSurface<S>,
  art: StageArt,
  end: number,
): Backdrop<S> {
  const back = art.back.map((layer) => bake(make, layer, end));
  const front = bake(make, art.front, end);
  return {
    draw(pen, camX, frame) {
      const cam = camera(camX, end);
      for (const layer of back) blit(pen, layer, cam);
      const style = pen.fillStyle;
      art.animate(pen, cam, clock(frame));
      pen.fillStyle = style;
    },
    drawFront(pen, camX) {
      blit(pen, front, camera(camX, end));
    },
  };
}
