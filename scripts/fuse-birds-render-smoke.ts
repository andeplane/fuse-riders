import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { advance, createMatch } from "../games/fuse-birds/src/engine/index.js";
import { startBirdsCoverage } from "./lib/fuse-birds-browser-coverage.js";

const base = process.argv[2] ?? "http://localhost:5181",
  output = process.argv[3] ?? "/tmp/fuse-birds-render";
await mkdir(output, { recursive: true });
const match = createMatch("render-check", 123, [
  { id: "cyan", name: "SKYE" },
  { id: "pink", name: "EMBER" },
  { id: "green", name: "FERN" },
  { id: "orange", name: "SOL" },
]);
while (match.phase === "preparing") advance(match);
const shot = match.preparation.witnesses.find(
  (w) => w.from === "cyan" && w.to === "pink" && w.wind === 0,
);
assert.ok(shot, "initial map has a verified shot");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  const errors: string[] = [];
  const finishCoverage = await startBirdsCoverage(page);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/games/fuse-birds/render-slice.html?mute`);
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent?.includes("aiming"),
    null,
    { timeout: 60_000 },
  );
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.screenshot({ path: `${output}/full-map.png` });
  const frameTimes = await page.evaluate<number[]>(`new Promise(resolve => {
    const samples = []; let previous;
    function sample(now) {
      if (previous !== undefined) samples.push(now - previous);
      previous = now;
      if (samples.length === 90) resolve(samples);
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  })`);
  const sorted = [...frameTimes].sort((a, b) => a - b);
  await writeFile(
    `${output}/performance.json`,
    JSON.stringify(
      {
        command: "pnpm exec tsx scripts/fuse-birds-render-smoke.ts",
        browser: browser.version(),
        seed: 123,
        players: 4,
        viewport: { width: 1600, height: 1000 },
        pixelRatio: await page.evaluate(() => devicePixelRatio),
        terrain: {
          width: 1536,
          height: 768,
          chunks: 72,
          texelsPerCell: 2,
          uploadsPerFrame: 4,
        },
        idleFrameMs: { p50: sorted[45], p95: sorted[85], max: sorted.at(-1) },
        frameTimes,
        limits:
          "Headless Chromium on the current machine; idle frame intervals, not physical-phone, GPU timing or worst-case explosion performance.",
      },
      null,
      2,
    ),
  );
  await page.mouse.move(800, 420);
  await page.mouse.down();
  await page.mouse.move(800 - shot.vx / 22, 420 - shot.vy / 22, { steps: 6 });
  await page.screenshot({ path: `${output}/aim.png` });
  await page.mouse.up();
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.includes("EMBER · aiming"),
  );
  await page.screenshot({ path: `${output}/crater.png` });
  await page.getByRole("button", { name: "Close-up" }).click();
  await page.screenshot({ path: `${output}/close-up.png` });
  // Exercise actual WebGL resource loss, without changing game state or clocks.
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!canvas || !extension)
      throw new Error("WebGL context-loss extension unavailable");
    canvas.addEventListener(
      "webglcontextlost",
      () => {
        setTimeout(() => extension.restoreContext(), 250);
      },
      { once: true },
    );
    extension.loseContext();
  });
  await page.locator('canvas[data-ready="false"]').waitFor();
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.screenshot({ path: `${output}/context-restored.png` });
  assert.deepEqual(errors, []);
  await finishCoverage();
  console.log(
    `Rendered a verified Pebble shot and captured full-map, aim, crater and close-up views: ${output}`,
  );
} finally {
  await browser.close();
}
