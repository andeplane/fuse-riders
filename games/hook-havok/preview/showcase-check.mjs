import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.argv[2];
if (
  !base?.startsWith("http://localhost:") &&
  !base?.startsWith("http://127.0.0.1:")
)
  throw new Error("Pass the local built-service base URL");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("?mute", base).href);
  const entry = page.getByRole("link", {
    name: "HOOK HAVOK — MOVEMENT PLAYGROUND ›",
  });
  await entry.click();
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  await page.getByRole("link", { name: "Art showcase", exact: true }).click();
  await page.locator('#status[data-state="ready"]').waitFor({ timeout: 20000 });
  assert.ok(page.url().includes("hook-havok/?showcase=1&mute"));
  assert.equal(await page.locator("#scene canvas").count(), 1);
  assert.equal(await page.locator("#play").textContent(), "Play");
  assert.equal(await page.locator("#atmosphere").isChecked(), false);
  await page.selectOption("#mode", "idle");
  async function seek(time) {
    await page.locator("#scrub").fill(String(time));
    await page.locator("#scrub").dispatchEvent("input");
    await page.waitForFunction(
      (time) => document.getElementById("scene").dataset.time === String(time),
      time,
    );
  }
  const registrations = [];
  for (const time of [0, 750, 1500, 2250, 3000]) {
    await seek(time);
    registrations.push(
      await page
        .locator("#scene")
        .evaluate((host) => [
          host.dataset.actorX,
          host.dataset.feet,
          host.dataset.frame,
        ]),
    );
  }
  assert.equal(
    new Set(registrations.map(JSON.stringify)).size,
    1,
    "idle must not translate sideways or switch generated poses",
  );
  await page.selectOption("#mode", "sequence");
  await page.check("#atmosphere");
  await seek(5800);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/hook-havok-showcase-desktop.png",
    fullPage: true,
  });
  await page.click("#play");
  await page.waitForFunction(
    () => Number(document.getElementById("scene").dataset.time) > 5900,
  );
  await page.click("#play");
  const times = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      values.push(document.getElementById("scene").dataset.time);
    }
    return values;
  });
  assert.equal(new Set(times).size, 1, "pause freezes scene time");
  await page.click("#replay");
  await page.waitForFunction(
    () => document.getElementById("scene").dataset.time === "0",
  );
  await seek(6900);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/hook-havok-showcase-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.route("**/belfry-background-source-*.png", (route) =>
    route.abort(),
  );
  await page.reload();
  await page.locator('#status[data-state="error"]').waitFor();
  await page.unroute("**/belfry-background-source-*.png");
  await page.click("#retry");
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(
    await page.locator("#scene canvas").count(),
    1,
    "retry creates one canvas",
  );
  await page
    .locator("#scene canvas")
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    );
  await page.locator('#status[data-state="error"]').waitFor();
  await page.click("#retry");
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#scene canvas").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: landing navigation, stable idle, reduced motion, timeline, replay, pause, resize, asset retry and context-loss retry.",
  );
} finally {
  await browser.close();
}
