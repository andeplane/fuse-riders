import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { webkit, type Page } from "playwright";
import { MAX_SCALE } from "../games/fuse-craft/src/render/camera.ts";
import { spriteRasterSize } from "../games/fuse-craft/src/render/sprite-raster.ts";

const output = process.argv[2] ?? "/tmp/fuse-raster-smoke";
mkdirSync(output, { recursive: true });
const browser = await webkit.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.goto(
    process.env.FUSE_CRAFT_URL ??
      "http://127.0.0.1:5174/games/fuse-craft/?mute",
  );
  await page.locator('[data-action="new-game"]').click();
  await page.locator('[data-action="mode-watch"]').click();
  await page.locator("#map-picker").selectOption("close-quarters");
  await page.locator('[data-action="start"]').click();
  const images = page.locator("#nd-board .building-art image");
  await page.waitForFunction(() =>
    document
      .querySelector("#nd-board .building-art image")
      ?.getAttribute("href")
      ?.startsWith("blob:"),
  );
  const normal = await images.first().getAttribute("href");
  assert.ok(normal?.startsWith("blob:"), "normal zoom uses a cached raster");
  const normalScale = await boardScale(page);
  await page.screenshot({ path: `${output}/normal-dpr2.png` });
  await page.mouse.move(640, 350);
  for (let i = 0; i < 20 && (await boardScale(page)) < MAX_SCALE - 0.05; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(150);
  }
  // Zoom-in stops at MAX_SCALE board pixels per unit (render/camera.ts), where
  // even at DPR 2 a bounded raster tier still covers the art, so the original
  // PNG is never needed; the tier only grows.
  await page.waitForFunction((max) => {
    const matrix = document
      .querySelector<SVGSVGElement>("#nd-board")
      ?.getScreenCTM();
    return !!matrix && Math.hypot(matrix.a, matrix.b) >= max - 0.05;
  }, MAX_SCALE);
  const zoomedScale = await boardScale(page);
  const tiers = [normalScale, zoomedScale].map((scale) =>
    spriteRasterSize(scale * 2),
  );
  assert.ok(tiers[1] !== null, `zoomed tier ${tiers[1]} is a cached raster`);
  await page.waitForFunction(
    (previous) => {
      const href = document
        .querySelector("#nd-board .building-art image")
        ?.getAttribute("href");
      return (
        !!href?.startsWith("blob:") && (previous === null || href !== previous)
      );
    },
    tiers[0] === tiers[1] ? null : normal,
  );
  const zoomed = await images.first().getAttribute("href");
  assert.ok(zoomed?.startsWith("blob:"), "close zoom uses a cached raster");
  await page.screenshot({ path: `${output}/close-dpr2.png` });
  for (
    let i = 0;
    i < 20 && (await boardScale(page)) > normalScale + 0.05;
    i++
  ) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(
    (previous) =>
      document
        .querySelector("#nd-board .building-art image")
        ?.getAttribute("href") === previous,
    normal,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        deviceScaleFactor: 2,
        normalScale,
        zoomedScale,
        rasterTiers: tiers,
        normalUsesCachedRaster: true,
        closeZoomUsesCachedRaster: true,
        zoomOutReturnsToSameCachedRaster: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

async function boardScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const matrix = document
      .querySelector<SVGSVGElement>("#nd-board")
      ?.getScreenCTM();
    return matrix ? Math.hypot(matrix.a, matrix.b) : 0;
  });
}
