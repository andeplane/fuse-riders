import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBuildingSprites,
  spriteRasterSize,
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
  assert.deepEqual(cache.resolve(1.8), sprites);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.size, 256);
  requests[0]!.finish("resized.png");
  await Promise.resolve();
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
