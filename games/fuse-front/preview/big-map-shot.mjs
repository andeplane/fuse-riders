/**
 * Screenshots a 3v3 on the biggest map against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/big-map-shot.mjs http://localhost:PORT/ games/fuse-front/docs/images
 *
 * CREATE ROOM, pick 3V3 and Iron Delta in the lobby (saved as `big-map-lobby.png`), start against five bots, zoom
 * all the way out once the countdown ends, let the armies march for a while, then save `big-map.png`. Muted.
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
    viewport: { width: 1280, height: 860 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}fuse-front/?mute`);
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  await page.getByRole("button", { name: "3V3" }).click();
  const iron = page.locator(".ff-maps button", { hasText: "Iron Delta" });
  await iron.waitFor({ timeout: 15_000 });
  await iron.click();
  await page
    .locator(".ff-maps .ff-on", { hasText: "Iron Delta" })
    .waitFor({ timeout: 10_000 });
  assert.equal(await page.locator(".ff-maps button").count(), 2);
  await page.screenshot({ path: join(dir, "big-map-lobby.png") });
  await page.getByRole("button", { name: "START" }).click();
  // Past the countdown: the hint under the board stops counting.
  await page.waitForFunction(
    () => /click to move/.test(document.body.innerText),
    undefined,
    { timeout: 90_000 },
  );
  const board = page.locator(".ff-stage canvas").first();
  const box = (await board.boundingBox()) ?? assert.fail("no board");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(Number(process.env.MARCH_MS ?? 60_000));
  await page.screenshot({ path: join(dir, "big-map.png") });
  assert.deepEqual(errors, []);
  console.log("ok");
} catch (error) {
  if (process.env.FAIL_SHOT)
    await browser.contexts()[0]?.pages()[0]?.screenshot({ path: process.env.FAIL_SHOT });
  console.log(errors);
  throw error;
} finally {
  await browser.close();
}
