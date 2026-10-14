import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Isolated render contract checks; the real solo flow is captured separately.
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No preview server");
const browser =
  process.env.BROWSER === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts", { recursive: true });
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID&mute`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  for (const backend of ["auto", "canvas"] as const) {
    console.log(
      await page.evaluate(async (backend) => {
        const { createPhaserArena } = (await import(
          String("/games/fuse-riders/src/render/phaser/arena.ts")
        )) as typeof import("../games/fuse-riders/src/render/phaser/arena.js");
        const { visualFixture } = (await import(
          String("/scripts/lib/benchmark-fixture.ts")
        )) as typeof import("./lib/benchmark-fixture.js");
        const { themes } = (await import(
          String("/games/fuse-riders/src/render/themes.ts")
        )) as typeof import("../games/fuse-riders/src/render/themes.js");
        document.body.replaceChildren();
        document.body.style.cssText = "margin:0;background:#020715";
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 900;
        document.body.append(canvas);
        const arena = createPhaserArena(canvas, {
          renderer: backend,
          resolution: "world",
        });
        await arena.ready;
        const base = {
          ...visualFixture(100),
          players: [],
          bombs: [],
          blasts: [],
          pickups: [],
          gravityFields: [],
          obstacles: [],
        };
        const pair = {
          id: "portal",
          expiresAtTick: 330,
          gates: [
            { x: 400, y: 450, halfLength: 100 },
            { x: 1200, y: 450, halfLength: 100 },
          ] as const,
        };
        const read = () => {
          const gl = backend === "auto" ? canvas.getContext("webgl") : null;
          if (!gl)
            return new Uint8Array(
              canvas.getContext("2d")!.getImageData(0, 0, 1600, 900).data,
            );
          const pixels = new Uint8Array(1600 * 900 * 4);
          gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          // Normalize WebGL's bottom-up rows for the region assertions below.
          const upright = new Uint8Array(pixels.length);
          for (let y = 0; y < 900; y++)
            upright.set(
              pixels.subarray(y * 6400, (y + 1) * 6400),
              (899 - y) * 6400,
            );
          return upright;
        };
        const region = (
          pixels: Uint8Array,
          x: number,
          y: number,
          width: number,
          height: number,
        ) => {
          const values: number[] = [];
          for (let row = y; row < y + height; row++)
            for (let col = x; col < x + width; col++) {
              const at = (row * 1600 + col) * 4;
              values.push(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!);
            }
          return values.join(",");
        };
        for (const theme of Object.values(themes)) {
          const paint = (tick: number, portals = [pair]) => {
            arena.render(
              { ...base, tick, presentationTick: tick, portalPairs: portals },
              1000,
              theme,
              "portal-browser",
            );
            return read();
          };
          const forming = paint(115);
          const active = paint(130);
          const half = paint(230);
          for (const x of [400, 1200]) {
            if (
              region(forming, x - 8, 360, 16, 180) ===
              region(active, x - 8, 360, 16, 180)
            )
              throw Error("Forming gate looks active");
            if (
              region(active, x - 26, 327, 52, 10) ===
              region(half, x - 26, 327, 52, 10)
            )
              throw Error("Countdown did not shrink at both ends");
            if (
              region(active, x - 8, 360, 16, 180) !==
              region(half, x - 8, 360, 16, 180)
            )
              throw Error("Active gate faded as its lifetime elapsed");
          }
          const expired = paint(330);
          const empty = paint(330, []);
          if (!expired.every((value, index) => value === empty[index]))
            throw Error("Expired gates left graphics behind");
        }
        arena.destroy();
        return `${backend}: forming appearance, two countdown bars, solid active gates, expiry passed`;
      }, backend),
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
