import assert from "node:assert/strict";
import test from "node:test";
import { Img, rgba } from "../src/render/pixel/image.js";
import { hash, vnoise } from "../src/render/pixel/noise.js";
import { robotPalette } from "../src/render/pixel/palette.js";

const pixel = (img: Img, x: number, y: number): number[] => [
  ...img.d.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4),
];

test("colours parse from hex and pass tuples through", () => {
  assert.deepEqual(rgba("#102030"), [16, 32, 48, 255]);
  const tuple = [1, 2, 3, 4] as const;
  assert.equal(rgba(tuple), tuple);
});

test("opaque pixels overwrite; off-image and missing colours draw nothing", () => {
  const img = new Img(2, 2);
  img.px(1.9, 0.2, "#ff0000");
  img.px(-1, 0, "#00ff00");
  img.px(2, 0, "#00ff00");
  img.px(0, 0, null);
  assert.deepEqual(pixel(img, 1, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(img, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(img, 0, 1), [0, 0, 0, 0]);
});

test("translucent colours blend over opaque pixels and keep their own colour over transparent ones", () => {
  const img = new Img(2, 1);
  img.px(0, 0, "#000000");
  img.px(0, 0, [255, 255, 255, 128]);
  assert.deepEqual(pixel(img, 0, 0), [128, 128, 128, 255]);
  img.px(1, 0, [200, 100, 50, 128]);
  assert.deepEqual(pixel(img, 1, 0), [200, 100, 50, 128]);
  img.px(1, 0, [200, 100, 50, 128]);
  assert.deepEqual(pixel(img, 1, 0), [200, 100, 50, 192]);
});

test("blit composites non-transparent pixels and clips at the edges", () => {
  const src = new Img(2, 1);
  src.px(1, 0, "#00ff00");
  const dst = new Img(2, 2);
  dst.rect(0, 0, 2, 2, "#0000ff");
  dst.blit(src, 1, 1);
  assert.deepEqual(pixel(dst, 1, 1), [0, 0, 255, 255]);
  dst.blit(src, 0, 0);
  assert.deepEqual(pixel(dst, 1, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(dst, 0, 0), [0, 0, 255, 255]);
});

test("string-row sprites skip dots and unknown characters and can mirror", () => {
  const img = new Img(3, 1);
  img.sprite(0, 0, ["a.?"], { a: "#ff0000" }, false);
  assert.deepEqual(pixel(img, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(img, 2, 0), [0, 0, 0, 0]);
  const flipped = new Img(3, 1);
  flipped.sprite(0, 0, ["a.?"], { a: "#ff0000" }, true);
  assert.deepEqual(pixel(flipped, 2, 0), [255, 0, 0, 255]);
});

test("hash and value noise are deterministic and stay in [0, 1)", () => {
  for (let i = -20; i < 20; i++) {
    const h = hash(i, i * 3, 7);
    const n = vnoise(i * 1.7, i * 0.3, 5, 2);
    assert.ok(h >= 0 && h < 1 && n >= 0 && n < 1);
    assert.equal(h, hash(i, i * 3, 7));
  }
});

test("a robot palette is built once per team", () => {
  assert.equal(robotPalette("red"), robotPalette("red"));
  assert.notEqual(robotPalette("red"), robotPalette("blue"));
});
