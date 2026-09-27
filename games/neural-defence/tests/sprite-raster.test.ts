import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  createBuildingSprites,
  spriteRasterSize,
  refreshSpriteImages,
  type SpriteRasterizer,
} from "../src/render/sprite-raster.js";

test("sprite resolution follows projected size and high-DPR close zoom keeps original", () => {
  assert.equal(spriteRasterSize(1), 128);
  assert.equal(spriteRasterSize(1.8), 256);
  assert.equal(spriteRasterSize(1.8 * 2), 512);
  assert.equal(spriteRasterSize(8), 1024);
  assert.equal(spriteRasterSize(8 * 2), null);
  assert.equal(spriteRasterSize(NaN), null);
  assert.equal(spriteRasterSize(0), null);
});

test("pending variants deduplicate, retain art and leave source/terrain/particles intact", async () => {
  const sprites = Object.freeze({
    "brain-v3": "brain.png",
    "particle-attack-v2": "particle.png",
    "terrain-walkable-v6": "ground.png",
  });
  const requests: Array<{
    url: string;
    size: number;
    finish: (url: string) => void;
  }> = [];
  const rasterizer: SpriteRasterizer = {
    resize: (url, size) =>
      new Promise((finish) => requests.push({ url, size, finish })),
  };
  const cache = createBuildingSprites(sprites, rasterizer);
  assert.deepEqual(cache.resolve(1.8), sprites);
  const pending = cache.resolve(1.8);
  assert.equal(cache.resolve(1.8), pending);
  assert.deepEqual(cache.resolve(1.8), sprites);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.size, 256);
  requests[0]!.finish("resized.png");
  await Promise.resolve();
  assert.notEqual(cache.resolve(1.8), pending);
  assert.equal(pending["brain-v3"], "brain.png");
  assert.deepEqual(cache.resolve(1.8), {
    ...sprites,
    "brain-v3": "resized.png",
  });
  assert.equal(sprites["brain-v3"], "brain.png");
  assert.equal(cache.resolve(16), sprites);
  cache.resolve(8);
  assert.equal(requests[1]!.size, 1024);
  assert.equal(cache.resolve(1.8)["brain-v3"], "resized.png");
});

test("camera-only sprite refresh preserves live DOM and uses the latest resolved art", () => {
  const { document } = parseHTML(
    `<svg><g transform="rotate(17)"><image data-sprite="brain-v3" href="small.png"/><image data-sprite="particle-attack" href="particle.png"/></g></svg>`,
  );
  const svg = document.querySelector("svg")!;
  const group = svg.querySelector("g")!;
  const image = svg.querySelector("image")!;
  refreshSpriteImages(svg, {
    "brain-v3": "original.png",
    "particle-attack-v2": "particle.png",
  });
  assert.equal(svg.querySelector("image"), image);
  assert.equal(image.getAttribute("href"), "original.png");
  assert.equal(group.getAttribute("transform"), "rotate(17)");
  refreshSpriteImages(svg, { "brain-v3": "ready.png" });
  assert.equal(image.getAttribute("href"), "ready.png");
  assert.equal(
    svg.querySelectorAll("image")[1]!.getAttribute("href"),
    "particle.png",
  );
});

test("failures retain originals without retry loops and arbitrary zoom has bounded variants", async () => {
  let calls = 0;
  const sprites = { "brain-v3": "brain.png" };
  const cache = createBuildingSprites(sprites, {
    resize: async () => {
      calls++;
      throw new Error("decode failed");
    },
  });
  for (let i = 1; i < 1000; i++) {
    assert.deepEqual(cache.resolve(i / 50), sprites);
    await Promise.resolve();
  }
  assert.equal(calls, 4);
});
