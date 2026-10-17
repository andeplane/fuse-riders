import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Img } from "../src/render/pixel/image.js";
import {
  HEROES,
  PORTRAIT_SIZE,
  portrait,
} from "../src/render/pixel/portraits.js";

const digest = (img: Img): string =>
  createHash("sha256").update(img.d).digest("hex");
const alphaAt = (img: Img, x: number, y: number): number | undefined =>
  img.d[(y * img.w + x) * 4 + 3];

function portraitOf(who: (typeof HEROES)[number]): Img {
  const img = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  portrait(img, 0, 0, who, "red");
  return img;
}

test("every portrait draws the same pixels twice", () => {
  for (const h of HEROES)
    assert.equal(digest(portraitOf(h)), digest(portraitOf(h)), h);
});

test("a portrait fills its own square only", () => {
  const canvas = new Img(PORTRAIT_SIZE + 2, PORTRAIT_SIZE + 2);
  portrait(canvas, 1, 1, "brick", "blue");
  assert.equal(alphaAt(canvas, 0, 0), 0);
  assert.equal(alphaAt(canvas, 1, 1), 255);
  assert.equal(alphaAt(canvas, PORTRAIT_SIZE, PORTRAIT_SIZE), 255);
  assert.equal(alphaAt(canvas, PORTRAIT_SIZE + 1, PORTRAIT_SIZE + 1), 0);
});

test("an image can draw into a caller's buffer of the right size", () => {
  const buffer = new Uint8ClampedArray(12 * 12 * 4);
  const view = new Img(12, 12, buffer);
  view.rect(0, 0, 1, 1, "#ff0000");
  assert.deepEqual([...buffer.subarray(0, 4)], [255, 0, 0, 255]);
  assert.throws(() => new Img(12, 11, buffer), RangeError);
});

test("team colour tints a portrait", () => {
  const red = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  const blue = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  portrait(red, 0, 0, "vix", "red");
  portrait(blue, 0, 0, "vix", "blue");
  assert.notEqual(digest(red), digest(blue));
});
