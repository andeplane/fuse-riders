import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

// Diagnostic frozen-world renderer regression, separate from ordinary UI smoke.
const output = process.argv[2] ?? "/tmp/fuse-raster-refresh";
mkdirSync(output, { recursive: true });
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:5174/games/neural-defence/?mute");
    // Raw JS avoids tsx's named-function helper in the page.
    const result = await page.evaluate(`(async () => {
      const root = '/games/neural-defence/src/';
      const { renderBoard } = await import(root + 'render/board.ts');
      const { createAttractScene } = await import(root + 'app/attract-scene.ts');
      const { spriteUrls } = await import(root + 'render/sprites.ts');
      const { createBuildingSprites, createBrowserSpriteRasterizer } = await import(root + 'render/sprite-raster.ts');
      const world = createAttractScene();
      const before = JSON.stringify(world);
      const cache = createBuildingSprites(spriteUrls, createBrowserSpriteRasterizer(document, () => new Image()));
      const provider = { resolve: scale => cache.resolve(scale * devicePixelRatio) };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'width:1280px;height:800px;display:block';
      svg.setAttribute('preserveAspectRatio', 'none');
      document.body.replaceChildren(svg);
      // Exactly one world render. All subsequent updates use its animation handle.
      const animation = renderBoard(svg, world, null, false, false, performance.now(), spriteUrls, provider);
      const originalGroup = svg.querySelector('.building-art');
      const image = originalGroup.querySelector('image');
      const waitFor = async (predicate) => {
        for (let i = 0; i < 240; i++) {
          const now = await new Promise(requestAnimationFrame);
          animation.animate(now);
          if (predicate()) return;
        }
        throw new Error('Frozen-world artwork did not refresh');
      };
      svg.setAttribute('viewBox', '0 0 1280 800');
      await waitFor(() => image.getAttribute('href').startsWith('data:'));
      const normal = image.getAttribute('href');
      svg.setAttribute('viewBox', '0 0 160 100');
      await waitFor(() => !image.getAttribute('href').startsWith('data:'));
      svg.setAttribute('viewBox', '0 0 400 250');
      await waitFor(() => image.getAttribute('href').startsWith('data:') && image.getAttribute('href') !== normal);
      svg.setAttribute('viewBox', '0 0 1280 800');
      await waitFor(() => image.getAttribute('href') === normal);
      return {
        worldUnchanged: JSON.stringify(world) === before,
        groupPreserved: svg.querySelector('.building-art') === originalGroup,
        imagePreserved: originalGroup.querySelector('image') === image,
        asyncReadyRefreshed: true, closeZoomOriginal: true, newTierReady: true, cachedTierRestored: true,
      };
    })()`);
    assert.deepEqual(result, {
      worldUnchanged: true,
      groupPreserved: true,
      imagePreserved: true,
      asyncReadyRefreshed: true,
      closeZoomOriginal: true,
      newTierReady: true,
      cachedTierRestored: true,
    });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${name}.png` });
    writeFileSync(
      `${output}/${name}.json`,
      JSON.stringify({ browser: browser.version(), result, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
}
