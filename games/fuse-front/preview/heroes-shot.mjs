/**
 * Screenshots the hero pick against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/heroes-shot.mjs http://localhost:PORT/ games/fuse-front/docs/images
 *
 * CREATE ROOM, pick Vix for the host's seat in the lobby (saved as `heroes-lobby.png`), start against a bot, check
 * the HUD shows Vix's kit, walk toward the middle and cast Cloak, then save `heroes.png`. Run by hand; muted.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { join } from "node:path";

const [base, dir] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? "") || !dir)
  throw new Error("Pass the local service URL and a screenshot directory");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}fuse-front/?mute`);
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  const vix = page.locator(".ff-team-0 .ff-hero[aria-label='vix']").first();
  await vix.waitFor({ timeout: 15_000 });
  await vix.click();
  await page
    .locator(".ff-team-0 .ff-hero.ff-on[aria-label='vix']")
    .waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(dir, "heroes-lobby.png") });
  if (process.env.MOBILE_SHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.MOBILE_SHOT, fullPage: true });
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(wide <= 390, `no sideways scroll at phone width (${wide})`);
    await page.setViewportSize({ width: 1100, height: 800 });
  }
  await page.getByRole("button", { name: "START" }).click();
  const snipe = page.locator(".ff-spell[title='Snipe']");
  await snipe.waitFor({ timeout: 20_000 });
  await page
    .locator(".ff-hud", { hasText: "RED" })
    .waitFor({ timeout: 20_000 });
  const board = page.locator(".ff-stage canvas").first();
  const box = (await board.boundingBox()) ?? assert.fail("no board");
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.4);
  await page.waitForTimeout(12_000);
  const cloak = page.locator(".ff-spell[title='Cloak']");
  await cloak.and(page.locator(":enabled")).waitFor({ timeout: 20_000 });
  await page.keyboard.press("w");
  await cloak
    .locator(".ff-secs", { hasText: /\d/ })
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(dir, "heroes.png") });
  assert.deepEqual(errors, []);
  console.log("ok");
} finally {
  await browser.close();
}
