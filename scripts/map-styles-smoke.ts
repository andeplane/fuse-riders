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
      String("/games/fuse-riders/src/render/phaser/arena.ts")
    )) as typeof import("../games/fuse-riders/src/render/phaser/arena.js");
    const { visualFixture } = (await import(
      String("/scripts/lib/benchmark-fixture.ts")
    )) as typeof import("./lib/benchmark-fixture.js");
    const { themes } = (await import(
      String("/games/fuse-riders/src/render/themes.ts")
    )) as typeof import("../games/fuse-riders/src/render/themes.js");
    const { generateObstacles, ARENA_MAP_RECIPES } = (await import(
      String("/games/fuse-riders/src/engine/arena-map.ts")
    )) as typeof import("../games/fuse-riders/src/engine/arena-map.js");
    const { fixedScenery, mapTracks, advanceScenery } = (await import(
      String("/games/fuse-riders/src/engine/scenery-motion.ts")
    )) as typeof import("../games/fuse-riders/src/engine/scenery-motion.js");
    const maps = ["desert", "forest", "city", "drift", "trains"] as const;
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
        sheet.height = maps.length * 570;
        const ctx = sheet.getContext("2d")!;
        for (const [index, map] of maps.entries()) {
          let seed = 292;
          const random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x1_0000_0000;
          };
          const sampled = ARENA_MAP_RECIPES[map].species.length > 0;
          const snapshot = {
            ...visualFixture(40),
            map,
            bombs: [],
            blasts: [],
            pickups: [],
            // The movers a map lays, advanced a little so the trains have left their sidings and the cross has drifted in.
            obstacles: sampled
              ? generateObstacles({
                  map,
                  random,
                  keepClear: [],
                  bounds: { minX: 60, minY: 60, maxX: 1540, maxY: 840 },
                })
              : fixedScenery(map, 1600, 900, 1).map((piece) => {
                  for (let tick = 0; tick < 160; tick += 1)
                    advanceScenery(piece, 1600, 900, mapTracks(map));
                  return piece;
                }),
            tracks: mapTracks(map),
            ...(map === "drift" ? { openEdges: true, boundaryInset: 0 } : {}),
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
