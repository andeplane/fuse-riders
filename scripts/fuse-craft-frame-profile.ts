import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { chromium, webkit } from "playwright";

const output = process.argv[2] ?? "/tmp/fuse-frame-profile";
const deviceScaleFactor = Number(process.argv[3] ?? 1);
const selectedBrowser = process.argv[4] ?? "all";
// Headless Chromium renders WebGL in software (SwiftShader) unless asked to
// use the GPU; pass "gpu" to measure the light layer on real hardware.
const gpu = process.argv[5] === "gpu";
assert.ok([1, 2, 3].includes(deviceScaleFactor), "DPR must be 1, 2 or 3");
assert.ok(["all", "chromium", "webkit"].includes(selectedBrowser));
mkdirSync(output, { recursive: true });
const revision = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = () =>
  execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--untracked-files=no",
      "games/neural-defence/src",
      "games/neural-defence/maps",
    ],
    { encoding: "utf8" },
  ).trim();
// Run engines sequentially to avoid profiling two browser workloads together.
// This observes frame callbacks only; it never drives or accelerates the game.
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (selectedBrowser !== "all" && selectedBrowser !== name) continue;
  const browser = await engine.launch(
    gpu && name === "chromium"
      ? {
          args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
        }
      : {},
  );
  try {
    const source = revision();
    assert.equal(dirty(), "", "profile a committed game source");
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**", (socket) => socket.close());
    await page.goto("http://127.0.0.1:5174/games/neural-defence/?mute");
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-watch"]').click();
    await page.locator("#map-picker").selectOption("close-quarters");
    await page.locator("#first-strategy-picker").selectOption("pressure");
    await page.locator("#strategy-picker").selectOption("balanced");
    await page.locator('[data-action="start"]').click();
    await page.waitForFunction(
      () => document.querySelector(".combat-damage"),
      undefined,
      { timeout: 300000 },
    );
    await page.locator('[data-action="find-battle"]').click();
    const startClock = await page.locator(".hud-mini").innerText();
    // Keep this browser-side observer untransformed: tsx's named-function helper
    // is not available in the page. No game globals or clocks are replaced.
    const frames = (await page.evaluate(`new Promise(resolve => {
      const intervals = [];
      let start, previous;
      const observe = now => {
        if (start === undefined) start = now;
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        if (now - start < 20000) requestAnimationFrame(observe);
        else resolve({ elapsed: now - start, intervals });
      };
      requestAnimationFrame(observe);
    })`)) as { elapsed: number; intervals: number[] };
    assert.ok(frames.intervals.length > 0);
    const sorted = [...frames.intervals].sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      sorted[Math.floor((sorted.length - 1) * fraction)];
    const result = {
      source,
      headless: true,
      deviceScaleFactor,
      startClock,
      node: process.version,
      cpu: cpus()[0]?.model,
      browser: name,
      browserVersion: browser.version(),
      webglRenderer: await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return gl && info
          ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
          : null;
      }),
      viewport: { width: 1280, height: 800 },
      mode: "ordinary watch, Close Quarters, Pressure versus Balanced",
      elapsedMs: frames.elapsed,
      callbacks: sorted.length,
      averageCallbacksPerSecond: (sorted.length * 1000) / frames.elapsed,
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      over25ms: sorted.filter((ms) => ms > 25).length,
      over50ms: sorted.filter((ms) => ms > 50).length,
      clock: await page.locator(".hud-mini").innerText(),
      players: await page.locator(".watch-players").innerText(),
      structures: await page.locator(".structure").count(),
      travelers: await page.locator(".attack-particle").count(),
      errors,
      intervalsMs: frames.intervals,
    };
    assert.deepEqual(errors, []);
    assert.equal(revision(), source, "source revision changed during profile");
    assert.equal(dirty(), "", "game source changed during profile");
    writeFileSync(`${output}/${name}.json`, JSON.stringify(result, null, 2));
    await page.screenshot({ path: `${output}/${name}.png` });
    const { intervalsMs, ...summary } = result;
    console.log(JSON.stringify({ ...summary, samples: intervalsMs.length }));
  } finally {
    await browser.close();
  }
}
