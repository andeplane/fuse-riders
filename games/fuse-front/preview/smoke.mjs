/**
 * Browser smoke for Fuse Front against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * The landing page shows the portal first in the header; CREATE ROOM opens a lobby with the size picker, two team
 * columns and START; the host cycles the bot's difficulty, starts a 1v1 against it, sends its hero across the map and
 * sets HOLD, and the battlefield keeps changing as the armies move. Run by hand; not in CI. Every page opens muted.
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
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const snap = (name) =>
    shots ? page.screenshot({ path: join(shots, `${name}.png`) }) : undefined;
  await page.goto(`${base}fuse-front/?mute`);
  const first = await page.locator("header.ff-top > *").first();
  assert.match((await first.getAttribute("class")) ?? "", /portal/);
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  await page.locator(".ff-team-1 .ff-cycle").waitFor({ timeout: 15_000 });
  assert.equal(await page.locator(".ff-sizes button").count(), 3);
  await page.locator(".ff-team-1 .ff-cycle").click();
  await page.locator(".ff-team-1", { hasText: "hard" }).waitFor();
  await snap("lobby");
  await page.getByRole("button", { name: "START" }).click();
  await page
    .locator(".ff-hud", { hasText: "stance" })
    .waitFor({ timeout: 15_000 });
  const board = page.locator("canvas.ff-board");
  const box = (await board.boundingBox()) ?? assert.fail("no board");
  // The battlefield is art pixels scaled by a whole number, its camera on the hero by the red fort.
  const scale = await board.evaluate(
    (canvas) => canvas.getBoundingClientRect().width / canvas.width,
  );
  assert.equal(scale, Math.round(scale), "a whole-number scale");
  // Open ground east of the red fort, toward the centre.
  await page.mouse.click(box.x + box.width * 0.38, box.y + box.height * 0.3);
  await page.keyboard.press("2");
  await page.locator(".ff-hud", { hasText: "HOLD" }).waitFor();
  const picture = () => board.evaluate((canvas) => canvas.toDataURL());
  const before = await picture();
  // Long enough for the first batches to meet: shots, flames and explosions on screen.
  await page.waitForTimeout(20_000);
  assert.notEqual(await picture(), before, "the armies move");
  await snap("match");
  assert.deepEqual(errors, []);
  console.log("fuse-front smoke: ok");
} finally {
  await browser.close();
}
