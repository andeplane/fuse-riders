import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  installSpriteRecovery,
  spriteFallback,
  type SpriteImageLoader,
} from "../src/render/sprite-recovery.js";
import { refreshSpriteImages } from "../src/render/sprite-raster.js";

function fixture(loader: SpriteImageLoader) {
  const { document, window } = parseHTML(
    '<main><svg><image data-sprite="deposit-biomass" href="/biomass.png"/><image data-sprite="deposit-biomass" href="/biomass.png"/></svg></main>',
  );
  const root = document.querySelector("main")!;
  const images = [...root.querySelectorAll("image")];
  const dispose = installSpriteRecovery(root, loader);
  // Linkedom needs bubbling to reach the root; browser smoke covers capture of
  // the real non-bubbling SVG image error.
  const fail = (index: number) =>
    images[index]!.dispatchEvent(new window.Event("error", { bubbles: true }));
  return { root, images, fail, dispose };
}
const settled = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("failed deposits show fallback, share a fresh decode, and survive frame refresh", async () => {
  const calls: string[] = [];
  let finish!: () => void;
  const f = fixture({
    load: (url) => {
      calls.push(url);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  f.fail(0);
  f.fail(1);
  assert.deepEqual(calls, ["/biomass.png?sprite-retry=1"]);
  assert.equal(
    f.images[0]!.getAttribute("href"),
    spriteFallback("deposit-biomass"),
  );
  refreshSpriteImages(f.root, { "deposit-biomass": "/biomass.png" });
  assert.equal(
    f.images[0]!.getAttribute("href"),
    spriteFallback("deposit-biomass"),
  );
  finish();
  await settled();
  assert.ok(f.images.every((image) => image.getAttribute("href") === calls[0]));
  refreshSpriteImages(f.root, { "deposit-biomass": "/biomass.png" });
  assert.equal(f.images[0]!.getAttribute("href"), calls[0]);
  // A genuinely different source/tier must still replace the recovered image.
  refreshSpriteImages(f.root, { "deposit-biomass": "/new.png" });
  assert.equal(f.images[0]!.getAttribute("href"), "/new.png");
  assert.equal(f.images[0]!.hasAttribute("data-sprite-source"), false);
  f.dispose();
});

test("permanent failures stay bounded even when the board rebuilds or recovery URL fails", async () => {
  const calls: string[] = [];
  const f = fixture({
    load: async (url) => {
      calls.push(url);
      throw new Error("offline");
    },
  });
  f.fail(0);
  await settled();
  f.fail(1);
  await settled();
  assert.deepEqual(calls, [
    "/biomass.png?sprite-retry=1",
    "/biomass.png?sprite-retry=2",
  ]);
  assert.ok(
    f.images.every(
      (image) =>
        image.getAttribute("href") === spriteFallback("deposit-biomass"),
    ),
  );
  f.dispose();

  const recovered = fixture({ load: async () => {} });
  recovered.fail(0);
  await settled();
  recovered.fail(0);
  await settled();
  assert.equal(
    recovered.images[0]!.getAttribute("href"),
    spriteFallback("deposit-biomass"),
    "a previously decoded URL failing again must not cause an error loop",
  );
  recovered.dispose();
});

test("late recovery cannot overwrite a new tier or mutate a disposed/detached board", async () => {
  let finish!: () => void;
  const f = fixture({
    load: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  f.fail(0);
  f.fail(1);
  f.images[1]!.remove();
  refreshSpriteImages(f.root, { "deposit-biomass": "/new.png" });
  finish();
  await settled();
  assert.equal(f.images[0]!.getAttribute("href"), "/new.png");
  assert.equal(
    f.images[1]!.getAttribute("href"),
    spriteFallback("deposit-biomass"),
  );
  f.dispose();

  const disposed = fixture({
    load: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  disposed.fail(0);
  disposed.dispose();
  finish();
  await settled();
  assert.equal(
    disposed.images[0]!.getAttribute("href"),
    spriteFallback("deposit-biomass"),
  );
});
