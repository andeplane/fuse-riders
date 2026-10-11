import test from "node:test";
import assert from "node:assert/strict";
import { createBackdrop, type Pen } from "../src/render/backdrop/backdrop.js";
import {
  AXE_X,
  BRAZIERS,
  FIRES,
  GLOW_RUNS,
  KEEP_END,
  KEEP_LENGTH,
  KERB,
  PIERS,
  SHARD_GLOW,
  SLABS,
  THRONE_X,
  VORHALS_KEEP,
} from "../src/render/backdrop/vorhals-keep.js";
import type { MakeSurface } from "../src/render/surface.js";
import {
  cameraEndPx,
  FLOOR_BOTTOM_PX,
  FLOOR_TOP_PX,
  gravesPx,
  STAGE_COUNT,
  stageLengthPx,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";

// Stage 4's backdrop against the same contract as the other stages' (`drowned-crypt.test.ts`), on the engine's Stage 4
// road.
const END = KEEP_END;

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
  return { layers, backdrop: createBackdrop(make, 4) };
}

const shared = bake();
/** The layer at the floor's speed: the halls and the throne room themselves. */
const road = shared.layers[3]!;

function frame(camX: number, step = 0, { backdrop } = shared) {
  const back = new RecordingPen();
  backdrop.draw(back, camX, step);
  const front = new RecordingPen();
  backdrop.drawFront(front, camX);
  const ids = back.blits.map((b) => ({ ...b, layer: b.layer.id }));
  return { back, front, blits: [...back.blits, ...front.blits], ids };
}

/** The colour the road holds at a world pixel. */
function roadAt(x: number, y: number) {
  const i = (y * road.width + x) * 4;
  return (road.rgba[i]! << 16) | (road.rgba[i + 1]! << 8) | road.rgba[i + 2]!;
}

const CAMERAS = [0, 1, 7, 100.6, 333, 641, 999, END - 0.4, END];

test("Vorhal's Keep paints its five layers once and every frame blits them at their rates, in whole pixels", () => {
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
    const rates = [0, cam >> 3, cam >> 2, cam, Math.floor((cam * 5) / 4)];
    const { blits } = frame(camX);
    assert.deepEqual(
      blits.map((b) => b.args[0]),
      rates,
      `camX ${camX}`,
    );
    for (const { args } of blits)
      assert.ok(args.every(Number.isInteger), `camX ${camX}: ${args.join()}`);
  }
});

test("its layers reach exactly to the keep's end, the road its whole length, and the camera is held to it", () => {
  for (const b of frame(END).blits)
    assert.equal(b.args[0]! + VIEW_W, b.layer.width);
  assert.equal(road.width, KEEP_LENGTH);
  const same = (a: number, b: number) =>
    assert.deepEqual(frame(a, 3), frame(b, 3), `${a} vs ${b}`);
  same(-50, 0);
  same(Number.NaN, 0);
  same(END + 400, END);
});

test("the keep is laid on the engine's Stage 4 road, five screens long, its crypt slabs where the bonewalkers rise", () => {
  // An override left behind would silently win over the engine's road.
  assert.ok(STAGE_COUNT >= 4);
  assert.equal(VORHALS_KEEP.cameraEnd, undefined);
  assert.deepEqual([stageLengthPx(4), cameraEndPx(4)], [KEEP_LENGTH, KEEP_END]);
  assert.deepEqual([KEEP_LENGTH, KEEP_END], [5 * VIEW_W, 4 * VIEW_W]);
  assert.deepEqual(SLABS, gravesPx(4).flat());
  assert.equal(SLABS.length, 16, "the halls' five and the throne room's three");
  // Each slab is opened where its bonewalker stands: the pit's black under its feet, its frame's lit far edge above.
  for (let i = 0; i < SLABS.length; i += 2) {
    const [x = 0, y = 0] = SLABS.slice(i, i + 2);
    assert.ok(y - 7 > FLOOR_TOP_PX && y + 3 < FLOOR_BOTTOM_PX, `slab at ${x}`);
    for (const dx of [-8, 0, 8])
      assert.equal(roadAt(x + dx, y - 1), 0x010103, `the pit at ${x + dx}`);
    assert.notEqual(roadAt(x, y - 7), 0x010103);
  }
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

test("the fires, embers and the axe's glow move with the frame, and the layers do not", () => {
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
  shared.backdrop.draw(pen, END, 77);
  assert.equal(pen.fillStyle, "#123456");
  for (const bad of [-1, -1000, Number.NaN, Infinity, -Infinity])
    assert.deepEqual(frame(END, bad), frame(END, 0), `step ${bad}`);
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

test("the back layers cover the whole screen without gaps, through to the throne, and the foreground keeps to the bottom edge", () => {
  for (const camX of [0, 333, 640, 1111, END - 1, END]) {
    const covered = coverage(frame(camX).back.blits);
    assert.equal(covered.indexOf(0), -1, `camX ${camX}: a gap`);
    const front = coverage(frame(camX).front.blits);
    const opaque = front.reduce((sum, c) => sum + c, 0);
    assert.ok(opaque < VIEW_W * 6, `camX ${camX}: ${opaque}`);
    assert.equal(front.subarray(0, VIEW_W * (VIEW_H - 16)).indexOf(1), -1);
  }
  const bases = [0, 300, 600, 900, END].map((camX) =>
    coverage(frame(camX).front.blits).reduce((sum, c) => sum + c, 0),
  );
  assert.ok(bases.filter(Boolean).length >= 3, `${bases.join()}`);
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

test("scrolling the camera a pixel moves every flame, ember and glowing shard a pixel, so nothing pops in or out inside the screen", () => {
  for (const step of [0, 37, 250])
    for (let camX = 0; camX < END; camX++)
      assert.deepEqual(
        moving(camX + 1, step, 1),
        moving(camX, step, 0),
        `camX ${camX} step ${step}`,
      );
});

test("torches burn on the piers and braziers on the kerb, two flanking the dais, and the axe's shards glow only in the throne room", () => {
  const flames = (camX: number) =>
    frame(camX, 30).back.fills.filter((f) => f.style === "#ffbc3a").length;
  assert.ok(flames(0) > 5 && flames(END) > 10);
  assert.equal(FIRES.length, PIERS.length + 1 + BRAZIERS.length);
  assert.deepEqual(BRAZIERS.slice(-2), [THRONE_X - 80, THRONE_X + 80]);
  // The fractures glow on the wall of the last screen, brightening and dimming with the frame.
  for (const [x0, x1, y] of GLOW_RUNS)
    assert.ok(Math.abs(x0 - AXE_X) < 20 && x1 > x0 && y < KERB);
  const glow = (camX: number, step: number) =>
    frame(camX, step).back.fills.filter((f) => SHARD_GLOW.includes(f.style));
  assert.equal(glow(0, 30).length, 0);
  const styles = new Set<string>();
  for (let step = 0; step < 240; step += 10)
    for (const f of glow(END, step)) styles.add(f.style);
  assert.deepEqual([...styles].sort(), [...SHARD_GLOW].sort());
});
