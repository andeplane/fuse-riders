import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

const output = process.argv[2] ?? "/tmp/fuse-tint-smoke";
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
    await page.routeWebSocket("**", (socket) => socket.close());
    await page.goto(
      process.env.FUSE_CRAFT_URL ??
        "http://127.0.0.1:5174/games/neural-defence/?mute",
    );
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-watch"]').click();
    await page.locator("#map-picker").selectOption("close-quarters");
    await page.locator('[data-action="start"]').click();
    await page.waitForFunction(() => {
      const groups = [
        ...document.querySelectorAll(
          "#nd-board .building-art, #nd-board .building-cast-shadow",
        ),
      ];
      return (
        groups.length >= 4 &&
        groups.every((group) => group.getAttribute("filter") === "none")
      );
    });
    const pixels = await page.evaluate<{
      alpha: number;
      alphaError: number;
      colorDifference: number;
      shadowRgb: number;
    }>(`(async () => {
      const root = '/games/neural-defence/src/render/';
      const { createBrowserSpriteRasterizer } = await import(root + 'sprite-raster.ts');
      const { spriteUrls } = await import(root + 'sprites.ts');
      const raster = createBrowserSpriteRasterizer(document, () => new Image(), blob => URL.createObjectURL(blob));
      const urls = await Promise.all([undefined, 145, 'shadow'].map(tint => raster.resize(spriteUrls['brain-v3'], 512, tint)));
      const data = await Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }));
      let alpha = 0, alphaError = 0, colorDifference = 0, shadowRgb = 0;
      for (let i = 0; i < data[0].length; i += 4) {
        alpha += data[0][i + 3];
        alphaError += Math.abs(data[0][i + 3] - data[1][i + 3]) + Math.abs(data[0][i + 3] - data[2][i + 3]);
        if (data[0][i + 3] > 16) {
          for (let c = 0; c < 3; c++) {
            colorDifference += Math.abs(data[0][i + c] - data[1][i + c]);
            shadowRgb = Math.max(shadowRgb, data[2][i + c]);
          }
        }
      }
      return { alpha, alphaError, colorDifference, shadowRgb };
    })()`);
    assert.ok(pixels.alpha > 100000);
    assert.ok(pixels.alphaError < pixels.alpha * 0.005);
    assert.ok(pixels.colorDifference > 100000);
    assert.ok(pixels.shadowRgb <= 2);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${name}.png` });
    writeFileSync(
      `${output}/${name}.json`,
      JSON.stringify({ browser: browser.version(), pixels, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
}
