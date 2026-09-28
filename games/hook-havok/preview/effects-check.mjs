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
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}hook-havok/?mute`);
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const choose = async (name, value) => {
    await page.locator(`select[name="${name}"]`).selectOption(value);
    await page.waitForFunction(
      ([n, v]) => document.querySelector(`select[name="${n}"]`)?.value === v,
      [name, value],
    );
    await page.waitForTimeout(600);
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
  const shots = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(45);
    const path = `${out}/impact-${i}.png`;
    await page.screenshot({ path });
    shots.push(path);
  }
  await page.keyboard.up("KeyK");
  const hits = await page.evaluate(() =>
    JSON.parse(document.querySelector("#scene").dataset.keepers ?? "[]"),
  );
  assert.ok(hits.length >= 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ shots: shots.length, out }));
} finally {
  await browser.close();
}
