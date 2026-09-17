import { createServer } from "vite";
import { chromium, webkit } from "playwright";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
function option(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max)
    throw Error(`Invalid ${name}`);
  return value;
}
const width = option("VIEWPORT_WIDTH", 1600, 200, 4096),
  height = option("VIEWPORT_HEIGHT", 1000, 200, 4096),
  dpr = option("DPR", 1, 1, 4);
const quality = process.env.QUALITY ?? (width <= 700 ? "low" : "high");
if (quality !== "low" && quality !== "high")
  throw Error("QUALITY must be low or high");
const tag = process.env.BENCH_TAG ?? "";
if (!/^[a-z0-9-]*$/.test(tag)) throw Error("Invalid BENCH_TAG");
const resolution = process.env.RESOLUTION ?? "display";
if (resolution !== "display" && resolution !== "world")
  throw Error("Invalid RESOLUTION");
const config = {
  width,
  height,
  dpr,
  quality,
  resolution,
  duration: option("DURATION_MS", 15000, 2000, 1800000),
};
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const sourceHashes = Object.fromEntries(
  await Promise.all(
    [
      "src/render/phaser/arena.ts",
      "src/render/blast-animation.ts",
      "src/render/phaser/trails.ts",
      "src/render/phaser/viewport.ts",
      "src/client/main.ts",
      "src/render/themes.ts",
      "scripts/lib/benchmark-fixture.ts",
      "scripts/phaser-benchmark.ts",
    ].map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ]),
  ),
);
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browser =
  process.env.BROWSER === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chrome", args: ["--enable-webgl"] });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: dpr,
});
const errors: string[] = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error(e.message);
});
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  await mkdir("artifacts", { recursive: true });
  await page.addInitScript("window.__name = value => value");
  // Avoid leaving the landing AI/render loop alive during a supposedly isolated measurement.
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  await page.evaluate(() => {
    document.querySelector("#app")!.remove();
    document.body.style.cssText = "margin:0;background:#020715";
  });
  const measure = async () => {
    const results = [];
    for (const mode of ["phaser-canvas", "phaser-webgl"] as const) {
      console.log(`Measuring ${mode}`);
      const result = await page.evaluate(
        async ({ config, mode }) => {
          const { createPhaserArena } = (await import(
            String("/src/render/phaser/arena.ts")
          )) as typeof import("../src/render/phaser/arena.js");
          const { visualFixture } = (await import(
            String("/scripts/lib/benchmark-fixture.ts")
          )) as typeof import("./lib/benchmark-fixture.js");
          const { defaultTheme } = (await import(
            String("/src/render/themes.ts")
          )) as typeof import("../src/render/themes.js");
          const wrapper = document.createElement("div");
          const fitWidth = Math.min(config.width, (config.height * 16) / 9);
          wrapper.style.cssText = `width:${fitWidth}px;height:${(fitWidth * 9) / 16}px`;
          document.body.append(wrapper);
          const canvas = document.createElement("canvas");
          canvas.width = 1600;
          canvas.height = 900;
          canvas.style.cssText = "width:100%;height:100%;object-fit:contain";
          wrapper.append(canvas);
          const engine = createPhaserArena(canvas, {
            renderer: mode === "phaser-canvas" ? "canvas" : "auto",
            quality: config.quality as "low" | "high",
            resolution: config.resolution as "display" | "world",
          });
          // Test-only cleanup keeps the final frame alive until Node takes its screenshot.
          Reflect.set(window, "__disposeRendererBenchmark", () => {
            engine.destroy();
            wrapper.remove();
          });
          await engine.ready;
          if (mode === "phaser-webgl" && engine.metrics().renderer !== "webgl")
            throw Error("WebGL benchmark requested but unavailable");
          const frames: number[] = [],
            cpu: number[] = [],
            objects: number[] = [],
            particles: number[] = [];
          let start = performance.now(),
            previous = start;
          await new Promise<void>((resolve, reject) => {
            function frame(now: number) {
              try {
                const elapsed = now - start;
                const snapshot = visualFixture(Math.floor(elapsed / 50));
                const before = performance.now();
                engine.render(snapshot, now, defaultTheme, "benchmark");
                const cost = performance.now() - before;
                if (elapsed > 1000) {
                  frames.push(now - previous);
                  cpu.push(cost);
                  objects.push(engine.metrics().objects);
                  particles.push(engine.metrics().particles);
                }
                previous = now;
                if (elapsed < config.duration) requestAnimationFrame(frame);
                else resolve();
              } catch (error) {
                reject(error);
              }
            }
            requestAnimationFrame(frame);
          });
          const percentile = (v: number[], p: number) =>
            [...v].sort((a, b) => a - b)[
              Math.min(v.length - 1, Math.floor(v.length * p))
            ] ?? 0;
          if (!frames.length) throw Error("No timing samples");
          const fitScale =
            Math.min(config.width / 1600, config.height / 900) * config.dpr;
          const expectedScale =
            config.resolution === "display" ? Math.min(fitScale, 2.4) : 1;
          if (
            canvas.width !== Math.round(1600 * expectedScale) ||
            canvas.height !== Math.round(900 * expectedScale)
          )
            throw Error("Backing dimensions differ from requested workload");
          // This all-living fixture samples blast geometry; only deaths now emit pooled particles.
          if (engine.metrics().automaticLoopRunning)
            throw Error("Phaser automatic loop still running");
          if (Math.max(...particles) > (config.quality === "low" ? 160 : 480))
            throw Error("Particle bound regression");
          return {
            mode,
            backing: { width: canvas.width, height: canvas.height },
            css: {
              width: canvas.getBoundingClientRect().width,
              height: canvas.getBoundingClientRect().height,
            },
            backend: engine.metrics().renderer,
            samples: frames.length,
            frame: {
              p50: percentile(frames, 0.5),
              p95: percentile(frames, 0.95),
              p99: percentile(frames, 0.99),
              max: Math.max(...frames),
            },
            cpu: {
              p50: percentile(cpu, 0.5),
              p95: percentile(cpu, 0.95),
              p99: percentile(cpu, 0.99),
            },
            maxObjects: Math.max(0, ...objects),
            maxParticles: Math.max(0, ...particles),
            trailHistoryBuilds: engine.metrics().trailHistoryBuilds,
            raw: { frames, cpu },
          };
        },
        { config, mode },
      );
      results.push(result);
      // WebKit can stall if a screenshot is awaited inside an exposed callback from page.evaluate.
      if (mode === "phaser-webgl")
        await page.screenshot({
          path: `artifacts/phaser-arena${tag ? `-${tag}` : ""}-${process.env.BROWSER ?? "chrome"}.png`,
          timeout: 10000,
        });
      await page.evaluate(() => {
        const dispose = Reflect.get(
          window,
          "__disposeRendererBenchmark",
        ) as () => void;
        dispose();
        Reflect.deleteProperty(window, "__disposeRendererBenchmark");
      });
    }
    return {
      ...(await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        devicePixelRatio,
      }))),
      config,
      results,
    };
  };
  const result = await Promise.race([
    measure(),
    new Promise<never>((_, reject) => {
      deadline = setTimeout(
        () =>
          reject(Error("Renderer benchmark exceeded its wall-clock budget")),
        config.duration * 2 + 30000,
      );
    }),
  ]);
  clearTimeout(deadline);
  await writeFile(
    `artifacts/phaser-benchmark-${tag ? `${tag}-` : ""}${process.env.BROWSER ?? "chrome"}.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        revision,
        sourceHashes,
        method:
          "Synthetic 5 riders, 800 segments, 24 projectiles, 5 bursts; sequential Phaser Canvas/WebGL, 1s warmup, no landing animation. Configured viewport/DPR and fitted CSS board; Both Phaser backends follow the configured resolution mode. Read actual backing sizes before comparing costs. Desktop browser emulation only, not physical-phone evidence.",
        ...result,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { ...result, results: result.results.map(({ raw, ...r }) => r), errors },
      null,
      2,
    ),
  );
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  clearTimeout(deadline);
  await browser.close();
  await server.close();
}
