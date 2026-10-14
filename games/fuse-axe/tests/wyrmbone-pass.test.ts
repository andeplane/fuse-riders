import test from "node:test";
import assert from "node:assert/strict";
import { createBackdrop, type Pen } from "../src/render/backdrop/backdrop.js";
import { FIRES } from "../src/render/backdrop/wyrmbone-pass.js";
import type { MakeSurface } from "../src/render/surface.js";
import {
  cameraEndPx,
  FLOOR_TOP_PX,
  stageLengthPx,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";

// Stage 2's backdrop against the same contract as Stage 1's (`backdrop.test.ts`), on its longer road.
const END = cameraEndPx(2);

interface Layer {
  id: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

type Fill = { style: string; x: number; y: number; w: number; h: number };
/** A blit: the layer, then `[sx, sy, sw, sh, dx, dy, dw, dh]`. */
type Blit = { layer: Layer; args: number[] };

/** A pen that records what it is asked to draw. */
class RecordingPen implements Pen<Layer> {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly fills: Fill[] = [];
  readonly blits: Blit[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.fills.push({ style: String(this.fillStyle), x, y, w, h });
  }
  drawImage(layer: Layer, ...args: number[]) {
    this.blits.push({ layer, args });
  }
}

function bake() {
  const layers: Layer[] = [];
  const make: MakeSurface<Layer> = (width, height) => {
    const rgba = new Uint8ClampedArray(0);
    const layer = { id: layers.length, width, height, rgba };
    layers.push(layer);
    return {
      image: layer,
      paint: { fillStyle: "", fillRect: () => assert.fail("no fast path") },
      putPixels: (rgba) => void (layer.rgba = rgba),
    };
  };
  return { layers, backdrop: createBackdrop(make, 2) };
}

const shared = bake();

function frame(camX: number, step = 0, { backdrop } = shared) {
  const back = new RecordingPen();
  backdrop.draw(back, camX, step);
  const front = new RecordingPen();
  backdrop.drawFront(front, camX);
  const ids = back.blits.map((b) => ({ ...b, layer: b.layer.id }));
  return { back, front, blits: [...back.blits, ...front.blits], ids };
}

const CAMERAS = [0, 1, 7, 100.6, 333, 641, 999, END - 0.4, END];

test("Wyrmbone Pass paints its five layers once and every frame blits them at their rates, in whole pixels", () => {
  const { layers, backdrop } = bake();
  assert.equal(layers.length, 5);
  for (let step = 0; step < 90; step++) {
    const pen = new RecordingPen();
    backdrop.draw(pen, step * 15, step);
    backdrop.drawFront(pen, step * 15);
    assert.deepEqual(
      pen.blits.map((b) => b.layer),
      layers,
    );
  }
  assert.equal(layers.length, 5);
  for (const camX of CAMERAS) {
    const cam = Math.floor(camX);
    const { blits } = frame(camX);
    const rates = [0, cam >> 3, cam >> 2, cam, Math.floor((cam * 5) / 4)];
    assert.deepEqual(
      blits.map((b) => b.args[0]),
      rates,
      `camX ${camX}`,
    );
    for (const { args } of blits)
      assert.ok(args.every(Number.isInteger), `camX ${camX}: ${args.join()}`);
  }
});

test("its layers reach exactly to the stage end, the road the stage's whole length, and the camera is held to it", () => {
  for (const b of frame(END).blits)
    assert.equal(b.args[0]! + VIEW_W, b.layer.width);
  assert.equal(shared.layers[3]!.width, stageLengthPx(2));
  const same = (a: number, b: number) =>
    assert.deepEqual(frame(a, 3), frame(b, 3), `${a} vs ${b}`);
  same(-50, 0);
  same(Number.NaN, 0);
  same(END + 400, END);
});

test("the same inputs draw the same pixels and calls", () => {
  const twin = bake();
  shared.layers.forEach((layer, i) => {
    const other = twin.layers[i]!;
    assert.deepEqual([other.width, other.height], [layer.width, layer.height]);
    assert.ok(Buffer.from(other.rgba).equals(Buffer.from(layer.rgba)));
  });
  for (const camX of CAMERAS)
    for (const step of [0, 13, 600]) {
      const [a, b] = [frame(camX, step, twin), frame(camX, step)];
      assert.deepEqual([a.ids, a.back.fills], [b.ids, b.back.fills]);
    }
});

test("the mist, the snow and the fires move with the frame, and the layers do not", () => {
  for (const camX of [0, 640, END]) {
    const [now, later] = [frame(camX, 30), frame(camX, 37)];
    assert.deepEqual(now.blits, later.blits);
    assert.ok(now.back.fills.length > 0, `camX ${camX}: nothing moves`);
    assert.notDeepEqual(now.back.fills, later.back.fills);
  }
});

test("nothing is drawn outside the 320 × 180 screen, in a colour that is not one, or with the pen's style left changed", () => {
  for (let camX = 0; camX <= END; camX += 3)
    for (const step of [0, 11, 59, 1234, 2 ** 31, -1, Number.NaN]) {
      const { back, blits } = frame(camX, step);
      for (const f of back.fills) {
        const where = `camX ${camX} step ${step}: ${JSON.stringify(f)}`;
        assert.ok(f.w > 0 && f.h > 0 && f.x >= 0 && f.y >= 0, where);
        assert.ok(f.x + f.w <= VIEW_W && f.y + f.h <= VIEW_H, where);
        assert.match(f.style, /^#[0-9a-f]{6}$/, where);
      }
      for (const { layer, args } of blits) {
        const [sx = -1, sy = -1, sw = 0, sh = 0, dx = -1, dy = -1] = args;
        assert.ok(sx >= 0 && sy >= 0 && dx >= 0 && dy >= 0, `${args}`);
        assert.ok(sx + sw <= layer.width && sy + sh <= layer.height);
        assert.ok(dx + sw <= VIEW_W && dy + sh <= VIEW_H);
        assert.deepEqual(args.slice(6), [sw, sh], "blits are never scaled");
      }
    }
  const pen = new RecordingPen();
  pen.fillStyle = "#123456";
  shared.backdrop.draw(pen, 1300, 77);
  assert.equal(pen.fillStyle, "#123456");
  for (const bad of [-1, -1000, Number.NaN, Infinity, -Infinity])
    assert.deepEqual(frame(1300, bad), frame(1300, 0), `step ${bad}`);
});

/** Which screen pixels the given blits paint opaque. */
function coverage(blits: Blit[]) {
  const covered = new Uint8Array(VIEW_W * VIEW_H);
  for (const { layer, args } of blits) {
    const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0] = args;
    for (let j = 0; j < sh; j++)
      for (let i = 0; i < sw; i++)
        if (layer.rgba[((sy + j) * layer.width + sx + i) * 4 + 3] === 255)
          covered[(dy + j) * VIEW_W + dx + i] = 1;
  }
  return covered;
}

test("the back layers cover the whole screen without gaps, through to the skull gate, and the foreground keeps to the bottom edge", () => {
  for (const camX of [0, 333, 640, 1111, END - 1, END]) {
    const covered = coverage(frame(camX).back.blits);
    assert.equal(covered.indexOf(0), -1, `camX ${camX}: a gap`);
    const front = coverage(frame(camX).front.blits);
    const opaque = front.reduce((sum, c) => sum + c, 0);
    assert.ok(opaque > 0 && opaque < VIEW_W * 6, `camX ${camX}: ${opaque}`);
    assert.equal(front.subarray(0, VIEW_W * (VIEW_H - 12)).indexOf(1), -1);
  }
});

/** One frame's animated pixels, `shift` columns over and kept to the columns two neighbouring views share. */
function moving(camX: number, step: number, shift: number) {
  const pixels = new Map<number, string>();
  for (const f of frame(camX, step).back.fills)
    for (let y = f.y; y < f.y + f.h; y++)
      for (let x = f.x; x < f.x + f.w; x++) pixels.set(y * VIEW_W + x, f.style);
  const inBoth = ([at]: [number, string]) =>
    (at % VIEW_W) + shift >= 1 && (at % VIEW_W) + shift < VIEW_W - 1;
  const kept = [...pixels].filter(inBoth);
  return kept.map(([at, c]) => `${at + shift} ${c}`).sort();
}

test("scrolling the camera a pixel moves the mist, the snow and every flame a pixel, so nothing pops in or out inside the screen", () => {
  for (const step of [0, 37])
    for (let camX = 0; camX < END; camX++)
      assert.deepEqual(
        moving(camX + 1, step, 1),
        moving(camX, step, 0),
        `camX ${camX} step ${step}`,
      );
});

test("only the raiders' camp and the skull gate burn: the campfire before the last screen, the torches and eyes in it", () => {
  const flames = (camX: number) =>
    frame(camX, 30).back.fills.filter((f) =>
      ["#fff6b8", "#ffc22e", "#f86420"].includes(f.style),
    ).length;
  assert.equal(flames(0), 0);
  assert.equal(flames(640), 0);
  assert.ok(flames(END) > 20);
  assert.equal(FIRES.filter(([x]) => x >= END).length, 4);
  assert.equal(FIRES.filter(([x]) => x < END && x + VIEW_W > END).length, 1);
});

test("the mist drifts above the road, never speckling its snowy back edge", () => {
  // The mist is the only thing drawn in this colour.
  const mist = (camX: number, step: number) =>
    frame(camX, step).back.fills.filter((f) => f.style === "#56628c");
  let seen = 0;
  for (let camX = 0; camX <= END; camX += 7)
    for (const step of [0, 90, 400, 777, 1234, 3000, 9001])
      for (const f of mist(camX, step)) {
        seen++;
        assert.ok(
          f.y + f.h <= FLOOR_TOP_PX,
          `camX ${camX} step ${step}: ${JSON.stringify(f)}`,
        );
      }
  assert.ok(seen > 1000, `${seen} mist fills`);
});
