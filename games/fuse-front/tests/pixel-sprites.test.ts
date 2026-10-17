import assert from "node:assert/strict";
import test from "node:test";
import { hpBar } from "../src/render/pixel/effects.js";
import { Img } from "../src/render/pixel/image.js";
import {
  HEROES,
  PORTRAIT_SIZE,
  portrait,
} from "../src/render/pixel/portraits.js";

test("a portrait never draws outside its square", () => {
  const margin = 8;
  const size = PORTRAIT_SIZE + margin * 2;
  for (const who of HEROES) {
    const img = new Img(size, size);
    portrait(img, margin, margin, who, "red");
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const inside =
          x >= margin &&
          y >= margin &&
          x < margin + PORTRAIT_SIZE &&
          y < margin + PORTRAIT_SIZE;
        if (!inside)
          assert.equal(img.d[(y * size + x) * 4 + 3], 0, `${who} ${x},${y}`);
      }
  }
});

test("a health bar fills in proportion and clamps out-of-range fractions", () => {
  const filled = (frac: number): number => {
    const img = new Img(20, 4);
    hpBar(img, 2, 1, 10, frac, "#00ff00");
    let n = 0;
    // The bar's second row is the plain fill colour.
    for (let x = 0; x < img.w; x++) {
      const i = (2 * img.w + x) * 4;
      if (img.d[i] === 0 && img.d[i + 1] === 255) n++;
    }
    return n;
  };
  assert.equal(filled(0), 0);
  assert.equal(filled(0.5), 5);
  assert.equal(filled(1), 10);
  assert.equal(filled(2), filled(1));
  assert.equal(filled(-1), 0);
  assert.equal(filled(Number.NaN), 0);
});
