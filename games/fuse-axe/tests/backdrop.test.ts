import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackdrop,
  type MakeSurface,
  type Pen,
  type StageNumber,
} from "../src/render/backdrop/backdrop.js";
import { ASHEN_VILLAGE } from "../src/render/backdrop/ashen-village.js";
import { hash, Raster } from "../src/render/backdrop/kit.js";
import {
  CAMERA_END_PX,
  FLOOR_TOP_PX,
  STAGE_LENGTH_PX,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";

/** The static layers a stage bakes: the back ones and the foreground. */
const LAYERS = ASHEN_VILLAGE.back.length + 1;

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
void ((ctx: OffscreenCanvasRenderingContext2D): Pen<OffscreenCanvas> => ctx);
void ((): MakeSurface<OffscreenCanvas> => (width, height, rgba) => {
  const canvas = new OffscreenCanvas(width, height);
  canvas
    .getContext("2d")
    ?.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
});

test("static layers are painted once, when the backdrop is made, and every frame reuses them", () => {
  const { surfaces, backdrop } = stage1();
  assert.equal(surfaces.length, LAYERS);
  for (let step = 0; step < 120; step++) {
    const pen = new RecordingPen();
    backdrop.draw(pen, step * 8, step);
    backdrop.drawFront(pen, step * 8);
    assert.deepEqual(
      pen.blits.map((b) => b.surface),
      surfaces,
    );
  }
  assert.equal(surfaces.length, LAYERS);
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

/** The village layer, painted at the floor's own speed: the stage itself. */
const VILLAGE = ASHEN_VILLAGE.back.findIndex(
  (layer) => layer.rate[0] === 1 && layer.rate[1] === 1,
);

test("the wall at the stage end has no slit between its stakes, towers and gate", () => {
  const village = shared.surfaces[VILLAGE]!;
  const { top } = ASHEN_VILLAGE.back[VILLAGE]!;
  for (const above of [4, 12, 20])
    for (let x = STAGE_LENGTH_PX - 230; x < STAGE_LENGTH_PX; x++) {
      const row = FLOOR_TOP_PX - above - top;
      assert.equal(
        village.rgba[(row * village.width + x) * 4 + 3],
        255,
        `stage x ${x}, ${above} px above the floor`,
      );
    }
});

/** One frame's flame and ember fills as sorted strings, moved by `shift` and kept to the columns both views share. */
function fillsAt(camX: number, step: number, shift: number) {
  return frame(camX, step)
    .back.fills.map((f) => ({ ...f, x: f.x + shift }))
    .filter((f) => f.x >= 0 && f.x < VIEW_W - 1)
    .map((f) => `${f.style} ${f.x},${f.y} ${f.w}x${f.h}`)
    .sort();
}

test("scrolling the camera a pixel moves every flame and ember a pixel, so none pops in or out inside the screen", () => {
  for (const step of [0, 37])
    for (let camX = 0; camX < CAMERA_END_PX; camX++)
      assert.deepEqual(
        fillsAt(camX + 1, step, 0),
        fillsAt(camX, step, -1),
        `camX ${camX} step ${step}`,
      );
});

test("a frame never leaves the pen's fill style changed or sets one that is not a colour", () => {
  for (const step of [0, 5, 1e6, 2 ** 31, 2 ** 40, -1, -1000, Number.NaN]) {
    const pen = new RecordingPen();
    pen.fillStyle = "#123456";
    shared.backdrop.draw(pen, 300, step);
    shared.backdrop.drawFront(pen, 300);
    assert.equal(pen.fillStyle, "#123456", `step ${step}`);
    assert.ok(pen.fills.length > 0);
    for (const f of pen.fills)
      assert.match(f.style, /^#[0-9a-f]{6}$/, `step ${step}`);
  }
});

test("a negative, NaN or infinite frame draws as frame 0", () => {
  for (const bad of [-1, -1000, Number.NaN, Infinity, -Infinity])
    for (const camX of [0, 300])
      assert.deepEqual(frame(camX, bad), frame(camX, 0), `step ${bad}`);
});

test("a stage without a backdrop is refused with a clear error", () => {
  const make: MakeSurface<number> = () => 0;
  for (const stage of [0, 2, -1, 1.5, Number.NaN])
    assert.throws(
      () => createBackdrop(make, stage as StageNumber),
      RangeError,
      `stage ${stage}`,
    );
});

test("a raster paints the pixel a coordinate falls in and clips at its edges", () => {
  const raster = new Raster(4, 10, 2);
  raster.px(1.5, 10.2, 0x112233);
  raster.px(3.9, 11.9, 0xaabbcc);
  for (const [x, y] of [
    [-0.5, 10],
    [4, 10],
    [0, 9.5],
    [0, 12],
    [Number.NaN, 10],
    [0, Number.NaN],
  ] as const)
    raster.px(x, y, 0xffffff);
  const expected = new Uint8ClampedArray(4 * 4 * 2);
  expected.set([0x11, 0x22, 0x33, 255], 4);
  expected.set([0xaa, 0xbb, 0xcc, 255], (4 + 3) * 4);
  assert.deepEqual(raster.rgba, expected);
});

test("the cosmetic hash is a fixed integer function, so every device lays the village out the same", () => {
  assert.deepEqual(
    [hash(0, 0), hash(1, 2), hash(123456, 7), hash(-5, 61)].map((v) =>
      v.toFixed(10),
    ),
    ["0.6588745038", "0.2771612045", "0.3819654305", "0.0742536318"],
  );
  for (let a = -20; a < 200; a++)
    for (let b = 0; b < 70; b++) {
      const h = hash(a, b);
      assert.ok(h >= 0 && h < 1, `hash(${a}, ${b}) = ${h}`);
    }
});
