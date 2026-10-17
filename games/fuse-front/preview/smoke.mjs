/**
 * Browser smoke for Fuse Front against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * The landing page shows the portal first in the header; CREATE ROOM opens a lobby with the size picker, two team
 * columns and START; the host cycles the bot's difficulty, starts a 1v1 against it, sends its hero across the map and
 * sets HOLD, and the battlefield keeps changing as the armies move. Then a solo match against a bot: the HUD shows a
 * block per sector and a locked ultimate, Q casts (and cools down), FOLLOW lights up, and a robot factory's orders
 * panel switches it to torches and shows its ETA; Esc closes it. `HUD_SHOT=path` saves a screenshot of the HUD.
 * Run by hand; not in CI. Every page opens muted.
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
  await page.locator(".ff-switch.ff-lit", { hasText: "HOLD" }).waitFor();
  const picture = () => board.evaluate((canvas) => canvas.toDataURL());
  const before = await picture();
  // Long enough for the first batches to meet: shots, flames and explosions on screen.
  await page.waitForTimeout(20_000);
  assert.notEqual(await picture(), before, "the armies move");
  await snap("match");

  // Solo against a bot: the HUD casts, switches stance and changes a factory's order.
  await page.goto(`${base}fuse-front/?solo=1&mute`);
  const q = page.locator(".ff-spell").first();
  await q.and(page.locator(":enabled")).waitFor({ timeout: 15_000 });
  assert.equal(await page.locator(".ff-block").count(), 17, "a block a sector");
  assert.match(
    await page.locator(".ff-spell.ff-gold .ff-secs").innerText(),
    /LV6/,
  );
  // Once the countdown is over, send Brick toward the middle and let the first batches meet before casting.
  await page.locator(".ff-hud", { hasText: "RED" }).waitFor();
  const solo = (await board.boundingBox()) ?? assert.fail("no board");
  await page.mouse.click(solo.x + solo.width * 0.4, solo.y + solo.height * 0.4);
  await page.waitForTimeout(16_000);
  await page.keyboard.press("q");
  await page
    .locator(".ff-spell .ff-secs", { hasText: /^\d+$/ })
    .first()
    .waitFor();
  assert.ok(await q.isDisabled(), "Q cools down after a cast");
  await page.getByRole("button", { name: "3 FOLLOW" }).click();
  await page.locator(".ff-switch.ff-lit", { hasText: "FOLLOW" }).waitFor();
  await page.getByRole("button", { name: "ROBOTS" }).first().click();
  await page
    .locator(".ff-orders .ff-choice.ff-lit", { hasText: "GRUNT" })
    .waitFor();
  await page.locator(".ff-choice", { hasText: "TORCH" }).click();
  await page.locator(".ff-choice.ff-lit", { hasText: "TORCH" }).waitFor();
  assert.match(await page.locator(".ff-eta").innerText(), /TORCH in \d+s/);
  await page.waitForTimeout(1_500);
  if (process.env.HUD_SHOT)
    await page.screenshot({ path: process.env.HUD_SHOT });
  await page.keyboard.press("Escape");
  await page.locator(".ff-orders").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("fuse-front smoke: ok");
} finally {
  await browser.close();
}
