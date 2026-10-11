import test from "node:test";
import assert from "node:assert/strict";
import { createBackdrop, type Pen } from "../src/render/backdrop/backdrop.js";
import {
  BANK,
  CRYPT_END,
  CRYPT_LENGTH,
  DROWNED_CRYPT,
  DRIPS,
  FIRES,
  GRAVES,
  SHORE,
} from "../src/render/backdrop/drowned-crypt.js";
import type { MakeSurface } from "../src/render/surface.js";
import {
  cameraEndPx,
  FLOOR_TOP_PX,
  STAGE_COUNT,
  stageLengthPx,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";

// Stage 3's backdrop against the same contract as Stages 1 and 2 (`backdrop.test.ts`, `wyrmbone-pass.test.ts`), on
// the engine's Stage 3 road.
const END = CRYPT_END;

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
  return { layers, backdrop: createBackdrop(make, 3) };
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
const FLAMES = ["#eaffe0", "#8ef0a8", "#36c27a"];

test("the Drowned Crypt paints its five layers once and every frame blits them at their rates, in whole pixels", () => {
  const { layers, backdrop } = bake();
  assert.equal(layers.length, 5);
  for (let step = 0; step < 90; step++) {
    const pen = new RecordingPen();
    backdrop.draw(pen, step * 15, step);
    backdrop.drawFront(pen, step * 15);
    const order = pen.blits.map((b) => b.layer);
    assert.deepEqual(order, layers);
  }
  assert.equal(layers.length, 5);
  for (const camX of CAMERAS) {
    const cam = Math.floor(camX);
    const rates = [0, cam >> 3, cam >> 2, cam, Math.floor((cam * 5) / 4)];
    const { blits } = frame(camX);
    const offsets = blits.map((b) => b.args[0]);
    assert.deepEqual(offsets, rates, `camX ${camX}`);
    for (const { args } of blits)
      assert.ok(args.every(Number.isInteger), `camX ${camX}: ${args.join()}`);
  }
});

test("its layers reach exactly to the crypt's end, the road its whole length, and the camera is held to it", () => {
  for (const b of frame(END).blits)
    assert.equal(b.args[0]! + VIEW_W, b.layer.width);
  assert.equal(shared.layers[3]!.width, CRYPT_LENGTH);
  assert.equal(CRYPT_END, CRYPT_LENGTH - VIEW_W);
  const same = (a: number, b: number) =>
    assert.deepEqual(frame(a, 3), frame(b, 3), `${a} vs ${b}`);
  same(-50, 0);
  same(Number.NaN, 0);
  same(END + 400, END);
});

test("the crypt is laid on the engine's Stage 3 road, five screens long, with no camera of its own", () => {
  // An override left behind would silently win over the engine's road.
  assert.ok(STAGE_COUNT >= 3);
  assert.equal(DROWNED_CRYPT.cameraEnd, undefined);
  assert.deepEqual(
    [stageLengthPx(3), cameraEndPx(3)],
    [CRYPT_LENGTH, CRYPT_END],
  );
  assert.deepEqual([CRYPT_LENGTH, CRYPT_END], [5 * VIEW_W, 4 * VIEW_W]);
  // The pits are the engine's graves, where the bonewalkers rise.
  assert.deepEqual(GRAVES, [318, 128, 702, 150, 988, 124, 1190, 146]);
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

test("the ripples, fog, fires and drips move with the frame, and the layers do not", () => {
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
  shared.backdrop.draw(pen, 1100, 77);
  assert.equal(pen.fillStyle, "#123456");
  for (const bad of [-1, -1000, Number.NaN, Infinity, -Infinity])
    assert.deepEqual(frame(1100, bad), frame(1100, 0), `step ${bad}`);
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

test("the back layers cover the whole screen without gaps, through to the great doors, and the foreground keeps to the bottom edge", () => {
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

test("scrolling the camera a pixel moves every ripple, wisp, flame and drip a pixel, so nothing pops in or out inside the screen", () => {
  for (const step of [0, 37, 250])
    for (let camX = 0; camX < END; camX++)
      assert.deepEqual(
        moving(camX + 1, step, 1),
        moving(camX, step, 0),
        `camX ${camX} step ${step}`,
      );
});

test("the fog keeps above the causeway and the ripples to the water, where the drips fall from the dead trees", () => {
  const [fog, rings, drops]: [Fill[], Fill[], Fill[]] = [[], [], []];
  for (let camX = 0; camX <= END; camX += 9)
    for (const step of [0, 90, 400, 777, 1234, 3000, 9001])
      for (const f of frame(camX, step).back.fills)
        if (f.style === "#2e4448") fog.push(f);
        else if (f.style === "#9cc4c4") drops.push(f);
        else if (["#6a8e92", "#41606a", "#273c44"].includes(f.style))
          rings.push(f);
  assert.ok(fog.length > 1000 && rings.length > 1000 && drops.length > 0);
  for (const f of fog) assert.ok(f.y + f.h <= FLOOR_TOP_PX, JSON.stringify(f));
  const onWater = (y: number) => (y >= BANK && y < FLOOR_TOP_PX) || y >= SHORE;
  for (const f of rings) assert.ok(f.h === 1 && onWater(f.y));
  for (const [x, top, bottom] of DRIPS)
    assert.ok(x > 0 && top < BANK && bottom > BANK && bottom < FLOOR_TOP_PX);
});

test("the braziers burn green along the bank, two flank the great doors, and the open graves lie on the causeway", () => {
  const flames = (camX: number) =>
    frame(camX, 30).back.fills.filter((f) => FLAMES.includes(f.style)).length;
  assert.ok(flames(0) > 10 && flames(END) > 20);
  assert.equal(FIRES.filter(([x]) => x >= END).length, 2);
  for (let i = 0; i < GRAVES.length; i += 2) {
    const [x = END, y = 0] = GRAVES.slice(i, i + 2);
    assert.ok(y > FLOOR_TOP_PX + 10 && y < SHORE - 10 && x < END);
  }
});
