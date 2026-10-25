/**
 * Shop shot for the 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/shop-shot.mjs http://localhost:PORT/ [out.png]
 *
 * In a solo match on Neon Duel the hero walks to the middle of the map and fights the waves there for gold, then
 * walks home (or respawns there) and, in its fort's courtyard, opens the shop (B), buys Track Boots from SYSTEMS and
 * shows the shop with the boots in slot 1. The shot goes to `out.png` (default games/fuse-front/docs/images/shop.png).
 * Muted, one headless Chromium, a few minutes of match time; run by hand, not in CI. BROWSER_ARGS as in
 * `queue-shot.mjs`.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
const out = process.argv[3] ?? "games/fuse-front/docs/images/shop.png";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
/** Seat 0's fort on Neon Duel (176 × 176), as minimap fractions. */
const HOME = [9.5 / 176, 166.5 / 176];
const BOOTS = 800;
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
  args: (process.env.BROWSER_ARGS ?? "").split(" ").filter(Boolean),
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}fuse-front/?solo=1&mute`);
  await page.locator("canvas.ff-board-3d").waitFor({ timeout: 30_000 });
  const t0 = Date.now();
  const log = (what) =>
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${what}`);
  const mini = page.locator(".ff-mini");
  const send = async ([fx, fy]) => {
    const box = (await mini.boundingBox()) ?? assert.fail("no minimap");
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, {
      button: "right",
    });
  };
  const gold = async () =>
    Number(
      (await page.locator(".ff-panel .ff-purse").textContent()).replace(
        /\D/g,
        "",
      ),
    );
  await page.waitForTimeout(3_000);
  // Out to the middle, where the waves meet: the hero shoots as it walks.
  await send([0.5, 0.5]);
  for (let i = 0; i < 80 && (await gold()) < BOOTS; i++) {
    await page.waitForTimeout(5_000);
    if (i % 6 === 0) log(`gold ${await gold()}`);
  }
  assert.ok((await gold()) >= BOOTS, "the hero earned enough for boots");
  log(`gold ${await gold()}: home`);
  await send(HOME);
  await page.keyboard.press("b");
  const note = page.locator(".ff-shop .ff-note");
  for (let i = 0; i < 60; i++) {
    if ((await note.textContent()) === "At your fort") break;
    await page.waitForTimeout(2_000);
    // A hero that fell and stood again at its fort is home too; one still walking is sent again.
    if (i % 10 === 9) await send(HOME);
  }
  assert.equal(await note.textContent(), "At your fort");
  log("at the fort");
  await page.locator(".ff-shop .ff-tab", { hasText: "SYSTEMS" }).click();
  await page.waitForTimeout(500);
  const boots = page
    .locator(".ff-ware", { hasText: "Track Boots" })
    .locator(".ff-buy");
  await boots.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".ff-items .ff-item .ff-mark")?.textContent ===
      "TB",
    undefined,
    { timeout: 15_000 },
  );
  log("bought Track Boots");
  // Off the board and the panel, so nothing shows a hover.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(800);
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
  assert.deepEqual(errors, []);
  console.log("shop shot: ok");
} finally {
  await browser.close();
}
