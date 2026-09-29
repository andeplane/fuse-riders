import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

/**
 * 10D effects check in a real room: hook the Belfry knockback target with a
 * keyboard shot and capture the impact frames, then pop an orb.
 *
 *   node games/hook-havok/preview/effects-check.mjs http://localhost:PORT/ [out-dir]
 */
const base = process.argv[2];
const out = process.argv[3] ?? "artifacts/hook-havok-effects";
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
    deviceScaleFactor: 1,
    // REDUCED=1 checks the reduced-motion path: no particles, flash or shake.
    reducedMotion: process.env.REDUCED ? "reduce" : "no-preference",
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}hook-havok/?mute`);
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const choose = async (name, value) => {
    await page.locator(`select[name="${name}"]`).selectOption(value);
    await page.waitForFunction(
      // Wait for the scene itself: each change restarts the trial and clears input.
      ([n, v]) => document.querySelector("#scene").dataset[n] === v,
      [name, value],
    );
    await page.waitForTimeout(1000);
  };
  await choose("map", "belfry");
  await choose("experiment", "target");
  await page.locator("#arena-focus").click();
  await page.locator("#scene").focus();
  await page.waitForTimeout(400);
  // Tap right to aim right without walking far, then fire.
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(30);
  await page.keyboard.up("KeyD");
  await page.keyboard.down("KeyK");
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hook !== "ready",
  );
  const shots = [];
  for (let i = 0; i < 4; i++) {
    const path = `${out}/impact-${i}.png`;
    await page.screenshot({ path });
    shots.push(path);
  }
  await page.keyboard.up("KeyK");
  const hits = Number(await page.locator("#scene").getAttribute("data-hits"));
  assert.ok(hits >= 1, "the keyboard shot struck the target");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ shots: shots.length, out }));
} finally {
  await browser.close();
}
