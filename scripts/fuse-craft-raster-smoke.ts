import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { webkit } from "playwright";

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
  await page.goto("http://127.0.0.1:5174/games/neural-defence/?mute");
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
  assert.ok(normal?.startsWith("blob:"));
  await page.screenshot({ path: `${output}/normal-dpr2.png` });
  await page.mouse.move(640, 350);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -400);
  await page.waitForFunction(() => {
    const svg = document.querySelector<SVGSVGElement>("#nd-board");
    const matrix = svg?.getScreenCTM();
    return (
      svg &&
      matrix &&
      Math.hypot(matrix.a, matrix.b) >= 7.9 &&
      !svg
        .querySelector(".building-art image")
        ?.getAttribute("href")
        ?.startsWith("blob:")
    );
  });
  const zoomed = await images.first().getAttribute("href");
  assert.ok(zoomed && !zoomed.startsWith("blob:"));
  await page.screenshot({ path: `${output}/close-dpr2.png` });
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 400);
  await page.waitForFunction(() =>
    document
      .querySelector("#nd-board .building-art image")
      ?.getAttribute("href")
      ?.startsWith("blob:"),
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        deviceScaleFactor: 2,
        normalUsesCachedRaster: true,
        closeZoomUsesOriginal: true,
        zoomOutReturnsToCachedRaster: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
