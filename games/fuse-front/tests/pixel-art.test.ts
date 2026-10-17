import assert from "node:assert/strict";
import test from "node:test";
import { Img } from "../src/render/pixel/image.js";

test("an image can draw into a caller's buffer of the right size", () => {
  const buffer = new Uint8ClampedArray(12 * 12 * 4);
  const view = new Img(12, 12, buffer);
  view.rect(0, 0, 1, 1, "#ff0000");
  assert.deepEqual([...buffer.subarray(0, 4)], [255, 0, 0, 255]);
  assert.throws(() => new Img(12, 11, buffer), RangeError);
});
