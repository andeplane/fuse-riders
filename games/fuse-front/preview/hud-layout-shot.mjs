/**
 * HUD layout and default zoom shots for the 3D battlefield against a running service (`pnpm build`, then
 * `service/dev.ts`):
 *
 *   node games/fuse-front/preview/hud-layout-shot.mjs http://localhost:PORT/ [dir] [suffix]
 *
 * A solo match on Neon Duel at 1600×1000, 1280×800 and 390×844, at the default zoom: the bottom panel must be one row
 * on the desktop sizes (the minimap beside the spells), and the phone must not scroll sideways. Each size logs how many
 * tiles of ground span the board's middle row, read from the canvas's `data-tile`. Shots go to `dir` (default
 * games/fuse-front/docs/images) as `hud-layout<suffix>.png`, `-1280` and `-390`. Muted, one headless Chromium.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
const dir = process.argv[3] ?? "games/fuse-front/docs/images";
const suffix = process.argv[4] ?? "";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [width, height, name] of [
    [1600, 1000, ""],
    [1280, 800, "-1280"],
    [390, 844, "-390"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}fuse-front/?solo=1&mute`);
    const board = page.locator("canvas.ff-board-3d");
    await board.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4_000);
    const box = (await board.boundingBox()) ?? assert.fail("no board");
    const tileAt = async (fx) => {
      const [x, y] = [box.x + box.width * fx, box.y + box.height / 2];
      await page.mouse.move(x + 3, y + 3);
      await page.mouse.move(x, y);
      await page.waitForTimeout(150);
      return (await board.getAttribute("data-tile"))?.split(",").map(Number);
    };
    const [left, right] = [await tileAt(0.02), await tileAt(0.98)];
    const across = left && right ? (right[0] - left[0]) / 0.96 : NaN;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const rows = await page.evaluate(() => {
      const panel = document.querySelector(".ff-panel");
      // Children whose middles sit below the first child's bottom start a new row.
      const boxes = [...(panel?.children ?? [])].map((c) =>
        c.getBoundingClientRect(),
      );
      let rows = 1;
      for (let i = 1, bottom = boxes[0]?.bottom ?? 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.top + b.height / 2 > bottom) (rows++, (bottom = b.bottom));
      }
      return {
        rows,
        panel: Math.round(panel?.getBoundingClientRect().height ?? 0),
        scroll: document.documentElement.scrollWidth,
      };
    });
    console.log(
      `${width}x${height}: ${across.toFixed(1)} tiles across a ${Math.round(box.width)}x${Math.round(box.height)} board; panel ${rows.panel} px, ${rows.rows} row(s), scroll width ${rows.scroll}`,
    );
    await page.screenshot({ path: `${dir}/hud-layout${suffix}${name}.png` });
    assert.ok(rows.scroll <= width, `no horizontal scroll at ${width} px`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("hud layout shot: ok");
} finally {
  await browser.close();
}
