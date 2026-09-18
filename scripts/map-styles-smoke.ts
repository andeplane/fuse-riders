/** Reproducible map contact sheets on both Phaser backends and visual styles. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const pictures = await page.evaluate(async () => {
    const { createPhaserArena } = (await import(
      String("/src/client/phaser/arena.ts")
    )) as typeof import("../src/client/phaser/arena.js");
    const { visualFixture } = (await import(
      String("/src/client/phaser/benchmark-fixture.ts")
    )) as typeof import("../src/client/phaser/benchmark-fixture.js");
    const { themes } = (await import(
      String("/src/client/themes.ts")
    )) as typeof import("../src/client/themes.js");
    const { generateObstacles } = (await import(
      String("/src/engine/arena-map.ts")
    )) as typeof import("../src/engine/arena-map.js");
    const pictures: { name: string; data: string }[] = [];
    for (const backend of ["auto", "canvas"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      canvas.style.cssText = "width:1600px;height:900px";
      document.body.append(canvas);
      const arena = createPhaserArena(canvas, { renderer: backend });
      await arena.ready;
      const expectedRenderer = backend === "auto" ? "webgl" : "canvas";
      if (arena.metrics().renderer !== expectedRenderer)
        throw Error(
          `Expected ${expectedRenderer}, got ${arena.metrics().renderer}`,
        );
      for (const theme of Object.values(themes)) {
        const sheet = document.createElement("canvas");
        sheet.width = 960;
        sheet.height = 3 * 570;
        const ctx = sheet.getContext("2d")!;
        for (const [index, map] of (
          ["desert", "forest", "city"] as const
        ).entries()) {
          let seed = 292;
          const random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x1_0000_0000;
          };
          const snapshot = {
            ...visualFixture(40),
            map,
            bombs: [],
            blasts: [],
            pickups: [],
            obstacles: generateObstacles({
              map,
              random,
              keepClear: [],
              bounds: { minX: 60, minY: 60, maxX: 1540, maxY: 840 },
            }),
          };
          arena.reset();
          arena.render(snapshot, performance.now(), theme, "map-art");
          ctx.fillStyle = "#080e1c";
          ctx.fillRect(0, index * 570, 960, 570);
          ctx.fillStyle = "#ffffff";
          ctx.font = "16px monospace";
          ctx.fillText(
            `${map.toUpperCase()} / ${theme.id} / ${arena.metrics().renderer}`,
            16,
            index * 570 + 21,
          );
          ctx.drawImage(canvas, 0, index * 570 + 30, 960, 540);
          // A blast-cleared set must render without retaining obsolete scenery.
          arena.render(
            { ...snapshot, obstacles: [] },
            performance.now(),
            theme,
            "map-art",
          );
        }
        pictures.push({
          name: `map-styles-${backend}-${theme.id}`,
          data: sheet.toDataURL("image/png"),
        });
      }
      arena.destroy();
      canvas.remove();
    }
    return pictures;
  });
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  for (const picture of pictures) {
    const encoded = picture.data.split(",")[1];
    assert.ok(encoded, "screenshot must contain base64 image data");
    await writeFile(
      `artifacts/${picture.name}.png`,
      Buffer.from(encoded, "base64"),
    );
  }
  console.log(
    "Map styles rendered on WebGL and Canvas in both themes; screenshots in artifacts/map-styles-*.png",
  );
} finally {
  await browser.close();
  await server.close();
}
