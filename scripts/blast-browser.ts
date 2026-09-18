import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Isolated renderer fixtures plus ordinary offline solo play; never touches an occupied room.
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browserName = process.env.BROWSER ?? "chrome";
const browser =
  browserName === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts", { recursive: true });
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const reports = [];
  for (const mode of ["webgl", "phaser-canvas"] as const) {
    const report = await page.evaluate(async (mode) => {
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
        renderer: mode === "webgl" ? "auto" : "canvas",
        resolution: "world",
      });
      await arena.ready;
      if (mode === "webgl" && arena!.metrics().renderer !== "webgl")
        throw Error("WebGL did not start");
      const base = {
        ...visualFixture(100),
        players: [],
        bombs: [],
        blasts: [],
        pickups: [],
        portalPairs: [],
        gravityFields: [],
      };
      const blast = {
        bombId: 42,
        circle: { x: 800, y: 450, radius: 140 },
        expiresAtTick: 108,
      };
      const paint = (
        snapshot:
          | typeof base
          | (Omit<typeof base, "blasts"> & { blasts: (typeof blast)[] }),
        theme: keyof typeof themes,
      ) => {
        arena.render(snapshot, 1000, themes[theme], "blast-browser");
      };
      const read = (): Uint8Array => {
        const gl = mode === "webgl" ? canvas.getContext("webgl") : null;
        if (!gl)
          return new Uint8Array(
            canvas.getContext("2d")!.getImageData(0, 0, 1600, 900).data,
          );
        const pixels = new Uint8Array(1600 * 900 * 4);
        gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const results = [];
      for (const theme of ["neon-pixel", "clean-neon"] as const) {
        paint(base, theme);
        const baseline = read();
        const areas: number[] = [];
        for (const tick of [100, 102.4, 105.2, 107.5]) {
          paint({ ...base, tick, blasts: [blast] }, theme);
          const pixels = read();
          let bright = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (
              pixels[i]! > 160 &&
              pixels[i + 1]! > 70 &&
              pixels[i + 2]! < 180 &&
              pixels[i]! > baseline[i]! + 50
            )
              bright++;
          }
          areas.push(bright);
        }
        // Repeated snapshots and expired blasts must not restart or retain a flash.
        paint({ ...base, tick: 102.4, blasts: [blast] }, theme);
        const first = read();
        paint({ ...base, tick: 102.4, blasts: [blast] }, theme);
        const repeat = read();
        if (!first.every((value, i) => value === repeat[i]))
          throw Error(`${mode}: repeated blast changed`);
        paint({ ...base, tick: 108, blasts: [blast] }, theme);
        const expired = read();
        if (!baseline.every((value, i) => value === expired[i]))
          throw Error(`${mode}: expired blast remained visible`);
        results.push({ theme, brightPixels: areas });
      }
      // Top: one explosion at 25/125/225/325 ms. Bottom: five bombs at the same age.
      paint(
        {
          ...base,
          tick: 100.5,
          blasts: [
            ...[108, 106, 104, 102].map((expiresAtTick, i) => ({
              ...blast,
              circle: { x: 200 + i * 400, y: 270, radius: 150 },
              expiresAtTick,
            })),
            ...[42, 43, 44, 45, 46].map((bombId, i) => ({
              bombId,
              circle: { x: 160 + i * 320, y: 650, radius: 130 },
              expiresAtTick: 106,
            })),
          ],
        },
        "neon-pixel",
      );
      const captions = document.createElement("div");
      captions.style.cssText =
        "position:fixed;inset:0;pointer-events:none;color:#a5bfff;font:16px monospace;letter-spacing:2px";
      for (const [text, top] of [
        ["POP / BLOOM / BREAK / CLEAR", 65],
        ["FIVE SIMULTANEOUS BOMBS · DIFFERENT IDS, SAME AGE", 475],
      ] as const) {
        const label = document.createElement("div");
        label.textContent = text;
        label.style.cssText = `position:absolute;top:${top}px;left:60px`;
        captions.append(label);
      }
      document.body.append(captions);
      Reflect.set(window, "disposeBlastCheck", () => {
        arena.destroy();
        canvas.remove();
      });
      return { mode, results };
    }, mode);
    for (const result of report.results) {
      const [pop, bloom, breaking, clear] = result.brightPixels;
      assert.ok(
        bloom! > pop! * 2,
        `${mode}/${result.theme}: bloom must visibly expand`,
      );
      assert.ok(
        breaking! < bloom! && clear! < breaking!,
        `${mode}/${result.theme}: circles must visibly contract`,
      );
    }
    reports.push(report);
    await page.screenshot({
      path: `artifacts/blast-${mode}-${browserName}.png`,
    });
    await page.evaluate(() => {
      (Reflect.get(window, "disposeBlastCheck") as () => void)();
    });
  }
  await page.goto(`http://127.0.0.1:${address.port}/?solo=1&benchmark=1`);
  await page.evaluate(() =>
    window.addEventListener("fuse-benchmark", (event) => {
      const sample = (
        event as CustomEvent<{ kind: string; event?: { type: string } }>
      ).detail;
      if (sample.kind === "event" && sample.event?.type === "explosion")
        document.body.dataset.blastObserved = "true";
    }),
  );
  await page.locator('canvas[data-renderer="phaser-webgl"]').waitFor();
  await page.waitForFunction(
    () => document.body.dataset.blastObserved === "true",
    undefined,
    { timeout: 30000 },
  );
  await page.screenshot({ path: `artifacts/blast-solo-${browserName}.png` });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ reports, soloExplosionObserved: true, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
