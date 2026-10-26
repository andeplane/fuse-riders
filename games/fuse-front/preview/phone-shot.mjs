/**
 * Phone layout shots for the 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/phone-shot.mjs http://localhost:PORT/ [dir] [suffix]
 *
 * A solo match on Neon Duel at 390×844 (portrait) and 844×390 (landscape), at the opening zoom. Each size checks that
 * the page doesn't scroll sideways or down, that the board takes most of the screen, and that the ground under the
 * board's middle is within a few tiles of this rider's hero, which opens on its fort. Shots go to `dir` (default
 * games/fuse-front/docs/images) as `phone-portrait<suffix>.png` and `phone-landscape<suffix>.png`. Muted, one headless
 * Chromium.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = process.argv[2];
const dir = process.argv[3] ?? "games/fuse-front/docs/images";
const suffix = process.argv[4] ?? "";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const duel = JSON.parse(
  readFileSync(new URL("../maps/neon-duel.json", import.meta.url), "utf8"),
);
// A solo rider takes seat 0, whose hero opens on its fort.
const fort = duel.forts.find((f) => f.seat === 0);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [width, height, name] of [
    [390, 844, "portrait"],
    [844, 390, "landscape"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}fuse-front/?solo=1&mute`);
    const board = page.locator("canvas.ff-board-3d");
    await board.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4_000);
    const box = (await board.boundingBox()) ?? assert.fail("no board");
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    const tile = (await board.getAttribute("data-tile"))
      ?.split(",")
      .map(Number);
    const off = tile ? Math.hypot(tile[0] - fort.x, tile[1] - fort.y) : NaN;
    const dims = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
    }));
    console.log(
      `${width}x${height}: board ${Math.round(box.width)}x${Math.round(box.height)} at y ${Math.round(box.y)}; middle tile ${tile} (${off.toFixed(1)} from the fort); page ${dims.scrollW}x${dims.scrollH}`,
    );
    await page.screenshot({ path: `${dir}/phone-${name}${suffix}.png` });
    assert.ok(dims.scrollW <= width, `no horizontal scroll at ${width} px`);
    assert.ok(dims.scrollH <= height, `no vertical scroll at ${height} px`);
    // MORE opens the rest of the panel, the minimap too, still without scrolling sideways.
    await page.locator(".ff-drawer").click();
    await page.locator(".ff-minimap").waitFor({ state: "visible" });
    const open = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(open <= width, `no horizontal scroll with the panel open`);
    assert.ok(box.height >= height * 0.6, `the board is ${box.height} px tall`);
    assert.ok(
      off <= 4,
      `the hero's fort is ${off} tiles from the board's middle`,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("phone shot: ok");
} finally {
  await browser.close();
}
