/**
 * Screenshots the robot units in a solo match against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/robots-shot.mjs http://localhost:PORT/ games/fuse-front/docs/images [seconds]
 *
 * Plays solo against the bot at forced high quality with the robots on FOLLOW for `seconds` (a software rasteriser
 * runs the clock slow, so allow a few minutes), then saves `robots-units.png` at the default zoom and
 * `robots-units-close.png` zoomed in on the hero and the robots round it. `QUALITY=low` shows the cheap path. Muted.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const [base, dir, secs = "150"] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? "") || !dir)
  throw new Error("Pass the local service URL and a screenshot directory");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 760 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const quality = process.env.QUALITY ?? "high";
  await page.goto(`${base}fuse-front/?solo=1&mute&quality=${quality}`);
  await page.locator("canvas.ff-board").waitFor({ timeout: 60_000 });
  // FOLLOW: the robots gather round the hero, where the camera is.
  await page.keyboard.press("3");
  await page.waitForTimeout(Number(secs) * 1000);
  await page.screenshot({ path: join(dir, "robots-units.png") });
  // Z zooms in on the followed hero.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("z");
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(dir, "robots-units-close.png") });
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
