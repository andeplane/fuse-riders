/**
 * Browser run of Fuse Axe's stage flow against a running service (`pnpm build`, then `service/dev.ts`), solo:
 *
 *   node games/fuse-axe/preview/flow.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * Rhea walks to the first wave and stands there until the ravagers have taken every life: the continue card counts
 * down; J continues and she drops back in; she falls again, and with the continue spent the run is over, with her
 * tally and the host's REMATCH, which sets out again. About two minutes. Run by hand; not in CI. Screenshots go to
 * the directory given, and nowhere else. The page opens muted.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const snap = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource/.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto(`${base}fuse-axe/?solo=1&mute`);
  await page.locator('main[data-screen="lobby"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-hero="rhea"]').click();
  await page.locator('main[data-hero="rhea"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "START" }).click();
  await page.locator('main[data-stage="running"]').waitFor({ timeout: 5_000 });
  // Out to the first wave, swing at it for a while (so the tally has something in it), then let the ravagers win.
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(4_500);
  await page.keyboard.up("ArrowRight");
  // Not into the countdown, where J is a vote.
  const card = page.locator(".fa-card");
  for (let swing = 0; swing < 40 && !(await card.isVisible()); swing++) {
    if (swing % 10 === 0)
      await page.keyboard.press(swing % 20 ? "KeyD" : "KeyA");
    await page.keyboard.down("KeyJ");
    await page.waitForTimeout(120);
    await page.keyboard.up("KeyJ");
    await page.waitForTimeout(120);
  }
  const started = Date.now();
  await page
    .locator('main[data-card="continue"]')
    .waitFor({ timeout: 150_000 });
  console.log(
    `every life lost after ${Math.round((Date.now() - started) / 1000)} s`,
  );
  assert.match(await card.textContent(), /CONTINUE\?/);
  assert.match(await card.textContent(), /Press ATTACK \(J \/ Z\)/);
  await page.waitForTimeout(1_200);
  await snap(page, "continue");
  const clock = Number(await page.locator(".fa-card-clock").textContent());
  assert.ok(clock > 0 && clock <= 10, `the countdown shows ${clock}`);
  // J continues: the card goes and the run plays on.
  await page.keyboard.down("KeyJ");
  await page.locator('main[data-card=""]').waitFor({ timeout: 5_000 });
  await page.keyboard.up("KeyJ");
  assert.equal(
    await page.locator("main").getAttribute("data-stage"),
    "running",
  );
  console.log(`continued with ${clock} s left`);
  // The second fall in the stage ends the run at once.
  await page.locator('main[data-card="defeat"]').waitFor({ timeout: 150_000 });
  assert.match(await card.textContent(), /GAME OVER/);
  assert.match(await card.textContent(), /STAGE 1 OF 1 · ASHEN VILLAGE/);
  assert.match(await page.locator(".fa-tally").textContent(), /RHEA/);
  await page.waitForTimeout(500);
  await snap(page, "game-over");
  await page.getByRole("button", { name: "REMATCH" }).click();
  await page.locator('main[data-card=""]').waitFor({ timeout: 5_000 });
  assert.equal(
    await page.locator("main").getAttribute("data-stage"),
    "running",
  );
  console.log("game over, then REMATCH set out again");
  await context.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("fuse-axe flow: ok");
} finally {
  await browser.close();
}
