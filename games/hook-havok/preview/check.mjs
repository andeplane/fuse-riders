// Run against the URL printed by serve.mjs. Tests the real source-art review flow.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const url = process.argv[2];
if (!url?.startsWith("http://127.0.0.1:"))
  throw new Error("Pass the local URL printed by preview/serve.mjs");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#frames figure").count(), 6);
  assert.equal(
    await page.locator("#pause").textContent(),
    "Play",
    "reduced motion starts paused",
  );
  await page.selectOption("#motion", "run");
  await page.click("#step");
  const first = await page.locator("#arena").getAttribute("data-frame");
  await page.click("#step");
  assert.notEqual(
    await page.locator("#arena").getAttribute("data-frame"),
    first,
    "frame stepping changes the pose",
  );
  const beforePlaying = await page.locator("#arena").getAttribute("data-frame");
  await page.click("#pause");
  await page.waitForFunction(
    (previous) => document.getElementById("arena").dataset.frame !== previous,
    beforePlaying,
  );
  await page.click("#pause");
  const pausedFrames = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(document.getElementById("arena").dataset.frame);
    }
    return samples;
  });
  assert.equal(
    new Set(pausedFrames).size,
    1,
    "paused animation stays on one pose",
  );
  await page.check("#guides");
  await page.selectOption("#size", "96");
  await page.click("#step");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/hook-havok-animation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile page should not overflow horizontally",
  );
  await page.screenshot({
    path: "artifacts/hook-havok-animation-mobile.png",
    fullPage: true,
  });
  const sheet = "**/lantern-keeper-six-pose-source.png";
  await page.route(sheet, (route) => route.abort());
  await page.reload();
  await page.locator('#status[data-state="error"]').waitFor();
  assert.equal(await page.locator("#retry").isVisible(), true);
  await page.unroute(sheet);
  await page.click("#retry");
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(
    await page.locator("#frames figure").count(),
    6,
    "retry must not duplicate frame tiles",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: artwork load, six frames, reduced motion, frame stepping, autoplay/pause, resize, failed-load retry; no page errors.",
  );
} finally {
  await browser.close();
}
