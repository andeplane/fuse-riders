import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackdrop,
  type MakeSurface,
  type Pen,
} from "../src/render/backdrop/backdrop.js";
import { CAMERA_END_PX, VIEW_H, VIEW_W } from "../src/engine/view-kit.js";

interface FakeSurface {
  id: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

interface Fill {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Blit {
  surface: FakeSurface;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** A pen that records every call: enough of a 2D context for the backdrop to draw on in Node. */
class RecordingPen implements Pen<FakeSurface> {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly calls: (Fill | Blit)[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push({ style: String(this.fillStyle), x, y, w, h });
  }
  drawImage(
    surface: FakeSurface,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) {
    this.calls.push({ surface, sx, sy, sw, sh, dx, dy, dw, dh });
  }
  get blits() {
    return this.calls.filter((c): c is Blit => "surface" in c);
  }
  get fills() {
    return this.calls.filter((c): c is Fill => "style" in c);
  }
}

function stage1() {
  const surfaces: FakeSurface[] = [];
  const make: MakeSurface<FakeSurface> = (width, height, rgba) => {
    const surface = { id: surfaces.length, width, height, rgba };
    surfaces.push(surface);
    return surface;
  };
  return { surfaces, backdrop: createBackdrop(make, 1) };
}

const shared = stage1();

/** One frame on the shared backdrop: its back pass, then its foreground pass. */
function frame(camX: number, step = 0) {
  const back = new RecordingPen();
  shared.backdrop.draw(back, camX, step);
  const front = new RecordingPen();
  shared.backdrop.drawFront(front, camX);
  return { back, front, blits: [...back.blits, ...front.blits] };
}

const CAMERAS = [
  0,
  1,
  7,
  100.6,
  333,
  641,
  800,
  CAMERA_END_PX - 0.4,
  CAMERA_END_PX,
];

// Compile-time only: the browser's own context and canvases plug straight in.
void ((ctx: CanvasRenderingContext2D): Pen<HTMLCanvasElement> => ctx);
void ((): MakeSurface<OffscreenCanvas> => (width, height, rgba) => {
  const canvas = new OffscreenCanvas(width, height);
  canvas
    .getContext("2d")
    ?.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
});

test("static layers are painted once, when the backdrop is made, and every frame reuses them", () => {
  const { surfaces, backdrop } = stage1();
  assert.equal(surfaces.length, 5);
  for (let step = 0; step < 120; step++) {
    const pen = new RecordingPen();
    backdrop.draw(pen, step * 8, step);
    backdrop.drawFront(pen, step * 8);
    assert.deepEqual(
      pen.blits.map((b) => b.surface),
      surfaces,
    );
  }
  assert.equal(surfaces.length, 5);
});

test("each layer scrolls at its parallax rate, in whole pixels: sky still, ridge 1/8, hills 1/4, village with the floor, grass 5/4", () => {
  for (const camX of CAMERAS) {
    const cam = Math.floor(camX);
    const { blits } = frame(camX);
    assert.deepEqual(
      blits.map((b) => b.sx),
      [
        0,
        Math.floor(cam / 8),
        Math.floor(cam / 4),
        cam,
        Math.floor((cam * 5) / 4),
      ],
      `camX ${camX}`,
    );
    for (const b of blits) {
      const args = [b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh];
      assert.ok(args.every(Number.isInteger), `camX ${camX}: ${args.join()}`);
    }
  }
});

test("every layer is exactly long enough to reach the stage end", () => {
  for (const b of frame(CAMERA_END_PX).blits)
    assert.equal(b.sx + VIEW_W, b.surface.width);
});

test("the camera is held to the stage", () => {
  const same = (a: number, b: number) =>
    assert.deepEqual(frame(a, 3), frame(b, 3), `${a} vs ${b}`);
  same(-50, 0);
  same(Number.NaN, 0);
  same(CAMERA_END_PX + 400, CAMERA_END_PX);
});

test("the same inputs draw the same pixels and calls", () => {
  const other = stage1();
  assert.equal(other.surfaces.length, shared.surfaces.length);
  shared.surfaces.forEach((s, i) => {
    const twin = other.surfaces[i]!;
    assert.deepEqual([twin.width, twin.height], [s.width, s.height]);
    assert.ok(Buffer.from(twin.rgba).equals(Buffer.from(s.rgba)));
  });
  for (const camX of CAMERAS)
    for (const step of [0, 13, 600]) {
      const pen = new RecordingPen();
      other.backdrop.draw(pen, camX, step);
      assert.deepEqual(
        pen.calls.map((c) =>
          "surface" in c ? { ...c, surface: c.surface.id } : c,
        ),
        frame(camX, step).back.calls.map((c) =>
          "surface" in c ? { ...c, surface: c.surface.id } : c,
        ),
      );
    }
});

test("the flames move with the frame, and the layers do not", () => {
  for (const camX of [0, 400, CAMERA_END_PX]) {
    const now = frame(camX, 30);
    const later = frame(camX, 37);
    assert.deepEqual(now.blits, later.blits);
    assert.ok(now.back.fills.length > 0, `camX ${camX}: no fire on screen`);
    assert.notDeepEqual(now.back.fills, later.back.fills);
    assert.deepEqual(now.back.fills, frame(camX, 30).back.fills);
  }
});

test("nothing is drawn outside the 320 × 180 screen", () => {
  for (let camX = 0; camX <= CAMERA_END_PX; camX += 3)
    for (const step of [0, 11, 59, 1234]) {
      const { back, blits } = frame(camX, step);
      for (const f of back.fills) {
        const where = `camX ${camX} step ${step}: ${JSON.stringify(f)}`;
        assert.ok(f.w > 0 && f.h > 0 && f.x >= 0 && f.y >= 0, where);
        assert.ok(f.x + f.w <= VIEW_W && f.y + f.h <= VIEW_H, where);
      }
      for (const b of blits) {
        const { surface, sx, sy, sw, sh, dx, dy, dw, dh } = b;
        assert.ok(
          sx >= 0 &&
            sy >= 0 &&
            sx + sw <= surface.width &&
            sy + sh <= surface.height,
        );
        assert.ok(dx >= 0 && dy >= 0 && dx + dw <= VIEW_W && dy + dh <= VIEW_H);
        assert.ok(sw === dw && sh === dh, "blits are never scaled");
      }
    }
});

/** Which screen pixels the given blits paint opaque. */
function coverage(blits: Blit[]) {
  const covered = new Uint8Array(VIEW_W * VIEW_H);
  for (const { surface, sx, sy, sw, sh, dx, dy } of blits)
    for (let j = 0; j < sh; j++)
      for (let i = 0; i < sw; i++)
        if (surface.rgba[((sy + j) * surface.width + sx + i) * 4 + 3] === 255)
          covered[(dy + j) * VIEW_W + dx + i] = 1;
  return covered;
}

test("the back layers cover the whole screen without gaps, through to the stage end", () => {
  for (const camX of [0, 480, CAMERA_END_PX - 1, CAMERA_END_PX]) {
    const covered = coverage(frame(camX).back.blits);
    assert.equal(
      covered.indexOf(0),
      -1,
      `camX ${camX}: gap at pixel ${covered.indexOf(0)}`,
    );
  }
});

test("the foreground grass keeps to the bottom edge and leaves the heroes mostly in view", () => {
  for (const camX of [0, CAMERA_END_PX]) {
    const covered = coverage(frame(camX).front.blits);
    const opaque = covered.reduce((sum, c) => sum + c, 0);
    assert.ok(
      opaque > 0 && opaque < VIEW_W * 6,
      `camX ${camX}: ${opaque} grass pixels`,
    );
    assert.equal(covered.subarray(0, VIEW_W * (VIEW_H - 12)).indexOf(1), -1);
  }
});
