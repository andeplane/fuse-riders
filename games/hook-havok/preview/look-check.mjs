import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

/**
 * 10B–10D look check: a real room in focus mode on a high-density desktop.
 * Asserts the render density and full-screen arena, then saves a full frame
 * and a 1:1 close-up for review.
 *
 *   node games/hook-havok/preview/look-check.mjs http://localhost:PORT/ [out-dir] [query]
 */
const base = process.argv[2];
const out = process.argv[3] ?? "artifacts/hook-havok-look";
const query = process.argv[4] ?? "";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}hook-havok/?mute${query}`);
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  if (process.env.MAP) {
    await page.locator("#map").selectOption(process.env.MAP);
    await page.waitForFunction(
      (map) => document.querySelector("#scene").dataset.map === map,
      process.env.MAP,
    );
  }
  await page.locator("#arena-focus").click();
  await page.locator("#scene").focus();
  // A little play: aim up, hook and reel, so the rope and effects are visible.
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyJ");
  await page.waitForTimeout(450);
  const canvas = await page.evaluate(() => {
    const c = document.querySelector("#scene canvas");
    const box = c.getBoundingClientRect();
    return {
      width: c.width,
      height: c.height,
      cssWidth: box.width,
      cssHeight: box.height,
    };
  });
  // A 1440-wide 2× screen is 2880 device pixels: 1.75 backing pixels per unit.
  assert.equal(canvas.width, 2800, "renders at display density, not 1600×900");
  assert.equal(canvas.height, 1575);
  assert.ok(
    Math.abs(canvas.cssWidth - 1440) < 2 ||
      Math.abs(canvas.cssHeight - 900) < 2,
    `focused arena fills the screen (${canvas.cssWidth}×${canvas.cssHeight})`,
  );
  await page.screenshot({ path: `${out}/focus-full.png` });
  const keeper = await page.evaluate(() => {
    const host = document.querySelector("#scene"),
      box = host.getBoundingClientRect(),
      k = box.width / 1600;
    return {
      x: box.left + Number(host.dataset.actorX) * k,
      y: box.top + Number(host.dataset.feet) * k,
    };
  });
  await page.screenshot({
    path: `${out}/focus-closeup.png`,
    clip: {
      x: Math.max(0, keeper.x - 180),
      y: Math.max(0, keeper.y - 260),
      width: 360,
      height: 320,
    },
  });
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyJ");
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/focus-after-rope-jump.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ canvas, keeper, out }));
} finally {
  await browser.close();
}
