/**
 * MOBA HUD shots for the 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/moba-shot.mjs http://localhost:PORT/ [dir]
 *
 * In a solo match on Neon Duel the hero walks to mid and fights the waves. The first shot waits for three of its
 * last-hit gold pop-ups (`moba-hud.png`), the second holds ` for the scoreboard (`scoreboard.png`). Then, at
 * 390 px wide with the folded panel opened (MORE), the page must not scroll sideways with the scoreboard or the shop
 * open. Shots go to `dir` (default games/fuse-front/docs/images). Muted, one headless Chromium, about two minutes;
 * run by hand, not in CI.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
const dir = process.argv[3] ?? "games/fuse-front/docs/images";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}fuse-front/?solo=1&mute`);
  await page.locator("canvas.ff-board-3d").waitFor({ timeout: 30_000 });
  const mini = page.locator(".ff-mini");
  const box = (await mini.boundingBox()) ?? assert.fail("no minimap");
  await page.waitForTimeout(3_000);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });
  for (let i = 0; i < 5; i++) await page.keyboard.press("x");
  await page.mouse.move(4, 4);
  // Pop-ups rise slowly here, as headless WebGL shoots slower than they fade.
  await page.addStyleTag({
    content: ".ff-float, .ff-notice { animation-duration: 40s !important; }",
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".ff-float").length >= 3,
    undefined,
    { timeout: 120_000 },
  );
  await page.screenshot({ path: `${dir}/moba-hud.png` });
  console.log(
    "pop-ups",
    (await page.locator(".ff-float").allTextContents()).join(" "),
  );
  const board = page.locator(".ff-score-board");
  await page.keyboard.down("`");
  await page.waitForTimeout(600);
  assert.ok(await board.isVisible(), "the scoreboard shows while ` is held");
  await page.screenshot({ path: `${dir}/scoreboard.png` });
  console.log("scoreboard", (await board.innerText()).replace(/\n/g, " | "));
  await page.keyboard.up("`");
  await page.waitForTimeout(300);
  assert.ok(!(await board.isVisible()), "and hides on release");
  // A phone: nothing scrolls sideways, with the scoreboard (its button) or the shop open.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  const score = page.locator(".ff-toggles .ff-switch", { hasText: "score" });
  const widths = [await width()];
  // The phone's panel lies folded over the board (v3 M7b); MORE opens the order toggles.
  await page.locator(".ff-drawer").click();
  await score.click();
  await page.waitForTimeout(500);
  widths.push(await width());
  await score.click();
  await page.locator(".ff-shop-open").click();
  await page.waitForTimeout(500);
  widths.push(await width());
  console.log("phone widths", widths.join(" "));
  assert.ok(Math.max(...widths) <= 390, "no horizontal scroll at 390 px");
  assert.deepEqual(errors, []);
  console.log("moba shot: ok");
} finally {
  await browser.close();
}
